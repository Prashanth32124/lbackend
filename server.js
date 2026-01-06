const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId, GridFSBucket } = require("mongodb");
const multer = require("multer");

dotenv.config();

const app = express();
const server = http.createServer(app);

/* ===================== CORS (CRITICAL FIX) ===================== */
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://loveuajuma.vercel.app/" // if deployed
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors()); // 🔥 preflight fix
app.use(express.json());

/* ===================== SOCKET.IO ===================== */
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://loveuajuma.vercel.app/"
    ],
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

/* ===================== CONSTANTS ===================== */
const CHAT_ID = "my-love-chat";
const onlineUsers = new Map();

/* ===================== MULTER (MEMORY SAFE FOR RENDER) ===================== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/* ===================== MONGODB ===================== */
MongoClient.connect(process.env.MONGO_URL)
  .then((client) => {
    console.log("✅ MongoDB connected");

    const db = client.db("love");
    const messagesCol = db.collection("messages");
    const usersCol = db.collection("llove");
    const bucket = new GridFSBucket(db, { bucketName: "voice_notes" });

    /* ===================== AUDIO ROUTES ===================== */

    // 📥 Upload audio
    app.post("/api/upload-audio", upload.single("audio"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No audio file" });
        }

        const filename = `${Date.now()}-${req.file.originalname}`;

        const uploadStream = bucket.openUploadStream(filename, {
          contentType: req.file.mimetype
        });

        uploadStream.end(req.file.buffer);

        uploadStream.on("finish", () => {
          res.json({
            url: `https://lbackend-2.onrender.com/api/audio/${filename}`
          });
        });

        uploadStream.on("error", (err) => {
          console.error("GridFS upload error:", err);
          res.status(500).json({ error: "Upload failed" });
        });

      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    // 🎧 Stream audio
    app.get("/api/audio/:filename", (req, res) => {
      try {
        res.set({
          "Content-Type": "audio/webm",
          "Accept-Ranges": "bytes"
        });

        const stream = bucket.openDownloadStreamByName(req.params.filename);
        stream.pipe(res);

        stream.on("error", () => {
          res.status(404).json({ error: "Audio not found" });
        });

      } catch (err) {
        res.status(500).json({ error: "Stream error" });
      }
    });

    /* ===================== SOCKET LOGIC ===================== */
    io.on("connection", (socket) => {

      socket.on("joinChat", (name) => {
        if (!name) return;
        const user = name.toLowerCase().trim();
        socket.join(CHAT_ID);
        onlineUsers.set(socket.id, user);
        io.to(CHAT_ID).emit(
          "updateUserStatus",
          Array.from(new Set(onlineUsers.values()))
        );
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
          edited: false
        };

        const result = await messagesCol.insertOne(message);
        io.to(CHAT_ID).emit("receiveMessage", {
          ...message,
          _id: result.insertedId
        });
      });

      socket.on("editMessage", async ({ id, content }) => {
        if (!id) return;
        await messagesCol.updateOne(
          { _id: new ObjectId(id) },
          { $set: { content, edited: true, updatedAt: new Date() } }
        );
        io.to(CHAT_ID).emit("messageEdited", { id, content });
      });

      socket.on("disconnect", () => {
        onlineUsers.delete(socket.id);
        io.to(CHAT_ID).emit(
          "updateUserStatus",
          Array.from(new Set(onlineUsers.values()))
        );
      });
    });

    /* ===================== REST APIs ===================== */

    app.post("/login", async (req, res) => {
      const { username, password } = req.body;
      const user = await usersCol.findOne({
        username: username.toLowerCase().trim(),
        password: password.trim()
      });
      if (!user) return res.status(401).json({ success: false });
      res.json({ success: true, name: user.username });
    });

    app.get("/api/messages", async (req, res) => {
      const msgs = await messagesCol
        .find({ chatId: CHAT_ID })
        .sort({ createdAt: 1 })
        .toArray();

      res.json(msgs);
    });

    /* ===================== HEALTH CHECK ===================== */
    app.get("/health", (req, res) => res.send("OK"));

    /* ===================== START SERVER ===================== */
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  })
  .catch((err) => console.error("❌ MongoDB error:", err));
