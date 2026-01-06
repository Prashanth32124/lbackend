const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId, GridFSBucket } = require("mongodb"); 
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer"); 
const { GridFsStorage } = require("multer-gridfs-storage");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const CHAT_ID = "my-love-chat";
const onlineUsers = new Map();

MongoClient.connect(process.env.MONGO_URL)
  .then((client) => {
    const db = client.db("love");
    const messagesCol = db.collection("messages");
    const usersCol = db.collection("llove");

    // ✅ Initialize GridFS Bucket for voice notes
    const bucket = new GridFSBucket(db, { bucketName: "voice_notes" });

    // ✅ Setup GridFS Storage for Multer
    const storage = new GridFsStorage({
      url: process.env.MONGO_URL,
      file: (req, file) => ({
        filename: `${Date.now()}-${file.originalname}`,
        bucketName: "voice_notes",
      }),
    });
    const upload = multer({ storage });

    /* ===================== NEW ROUTES FOR VOICE ===================== */

    // 📥 UPLOAD VOICE (Fixes the 404 error)
    app.post("/api/upload-audio", upload.single("audio"), (req, res) => {
      if (!req.file) return res.status(400).json({ error: "Upload failed" });
      
      const audioUrl = `https://lbackend-2.onrender.com/api/audio/${req.file.filename}`;
      res.json({ url: audioUrl });
    });

    // 🎧 STREAM VOICE (To play the audio in the frontend)
    app.get("/api/audio/:filename", async (req, res) => {
      try {
        const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
        downloadStream.pipe(res);
      } catch (err) {
        res.status(404).json({ error: "Not found" });
      }
    });

    /* ===================== SOCKET LOGIC ===================== */

    io.on("connection", (socket) => {
      socket.on("joinChat", (name) => {
        if (!name) return;
        const user = name.toLowerCase().trim();
        socket.join(CHAT_ID);
        onlineUsers.set(socket.id, user);
        io.to(CHAT_ID).emit("updateUserStatus", Array.from(new Set(onlineUsers.values())));
      });

      socket.on("sendMessage", async (data) => {
        const now = new Date();
        const message = {
          chatId: CHAT_ID,
          sender: data.sender,
          content: data.content || "",
          image: data.image || null,
          audio: data.audio || null, 
          video: data.video || null,
          createdAt: now,
          time: now.toISOString(),
          edited: false,
        };

        const result = await messagesCol.insertOne(message);
        io.to(CHAT_ID).emit("receiveMessage", { ...message, _id: result.insertedId });
      });

      socket.on("editMessage", async ({ id, content }) => {
        if (!id || typeof content !== "string") return;
        const _id = new ObjectId(id);
        await messagesCol.updateOne({ _id }, { $set: { content, edited: true, updatedAt: new Date() } });
        io.to(CHAT_ID).emit("messageEdited", { id: id.toString(), content });
      });

      socket.on("disconnect", () => {
        onlineUsers.delete(socket.id);
        io.to(CHAT_ID).emit("updateUserStatus", Array.from(new Set(onlineUsers.values())));
      });
    });

    /* ===================== HTTP ROUTES ===================== */

    app.post("/login", async (req, res) => {
      const { username, password } = req.body;
      const user = await usersCol.findOne({
        username: username.toLowerCase().trim(),
        password: password.trim(),
      });
      if (!user) return res.status(401).json({ success: false });
      res.json({ success: true, name: user.username });
    });

    app.get("/api/messages", async (req, res) => {
      const msgs = await messagesCol.find({ chatId: CHAT_ID }).sort({ createdAt: 1 }).toArray();
      const formatted = msgs.map((m) => ({ ...m, time: m.time || m.createdAt }));
      res.json(formatted);
    });

    server.listen(5000, () => console.log("🚀 Server running on port 5000"));
  })
  .catch((err) => console.error("MongoDB error:", err));