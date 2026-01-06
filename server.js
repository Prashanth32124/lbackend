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

// ✅ CORS CONFIGURATION: Resolves access blocks from localhost to Render
app.use(cors({
  origin: ["http://localhost:3000", "https://your-frontend-link.vercel.app"],
  methods: ["GET", "POST", "DELETE", "PUT"],
  credentials: true
}));

app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const CHAT_ID = "my-love-chat";
const onlineUsers = new Map();

// ✅ CONNECT TO MONGODB
MongoClient.connect(process.env.MONGO_URL)
  .then((client) => {
    const db = client.db("love");
    const messagesCol = db.collection("messages");
    const usersCol = db.collection("llove");

    // ✅ INITIALIZE GRIDFS BUCKET
    const bucket = new GridFSBucket(db, { bucketName: "voice_notes" });

    // ✅ SETUP GRIDFS STORAGE FOR MULTER
    const storage = new GridFsStorage({
      url: process.env.MONGO_URL,
      file: (req, file) => ({
        filename: `${Date.now()}-${file.originalname}`,
        bucketName: "voice_notes",
      }),
    });
    const upload = multer({ storage });

    /* ===================== VOICE MESSAGE ROUTES ===================== */

    // 📥 UPLOAD VOICE: Fixes 404 error
    app.post("/api/upload-audio", upload.single("audio"), (req, res) => {
      if (!req.file) return res.status(400).json({ error: "Upload failed" });
      
      const audioUrl = `https://lbackend-2.onrender.com/api/audio/${req.file.filename}`;
      res.json({ url: audioUrl });
    });

    // 🎧 STREAM VOICE: To play back audio
    app.get("/api/audio/:filename", async (req, res) => {
      try {
        const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
        downloadStream.pipe(res);
      } catch (err) {
        res.status(404).json({ error: "File not found" });
      }
    });

    /* ===================== SOCKET.IO LOGIC ===================== */

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

      socket.on("deleteMessage", (messageId) => {
        io.to(CHAT_ID).emit("messageDeleted", messageId);
      });

      socket.on("disconnect", () => {
        onlineUsers.delete(socket.id);
        io.to(CHAT_ID).emit("updateUserStatus", Array.from(new Set(onlineUsers.values())));
      });
    });

    /* ===================== HTTP API ROUTES ===================== */

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

    app.delete("/api/messages/:id", async (req, res) => {
      try {
        const { id } = req.params;
        await messagesCol.deleteOne({ _id: new ObjectId(id) });
        io.to(CHAT_ID).emit("messageDeleted", id);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false });
      }
    });

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => console.error("MongoDB error:", err));