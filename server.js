const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
const server = http.createServer(app);

/* ===================== CORS ===================== */
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://loveuajuma.vercel.app"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());
app.use(express.json());

/* ===================== SOCKET.IO ===================== */
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://loveuajuma.vercel.app"
    ],
    credentials: true
  }
});

/* ===================== CONSTANTS ===================== */
const CHAT_ID = "my-love-chat";
const onlineUsers = new Map();

/* ===================== SUPABASE ===================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===================== MULTER ===================== */
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

    /* ===================== AUDIO UPLOAD (SUPABASE) ===================== */
    app.post("/api/upload-audio", upload.single("audio"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No audio file" });
        }

        const fileName = `voice_${Date.now()}.webm`;

        const { error } = await supabase.storage
          .from("voice-notes")
          .upload(fileName, req.file.buffer, {
            contentType: "audio/webm"
          });

        if (error) {
          console.error("Supabase upload error:", error);
          return res.status(500).json({ error: "Upload failed" });
        }

        const { data } = supabase.storage
          .from("voice-notes")
          .getPublicUrl(fileName);

        return res.json({ url: data.publicUrl });

      } catch (err) {
        console.error("Server error:", err);
        res.status(500).json({ error: "Server error" });
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
          { $set: { content, edited: true } }
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

    /* ===================== HEALTH ===================== */
    app.get("/health", (req, res) => res.send("OK"));

    /* ===================== START ===================== */
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  })
  .catch((err) => console.error("❌ MongoDB error:", err));
