const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");
const http = require("http");
const { Server } = require("socket.io");

dotenv.config();

const app = express();

// Standard CORS that works with all Express versions
app.use(cors()); 
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const CHAT_ID = "my-love-chat";
const onlineUsers = new Map();

// ✅ Use your existing MONGO_URL from .env
MongoClient.connect(process.env.MONGO_URL)
  .then((client) => {
    console.log("✅ MongoDB connected");
    const db = client.db("love");
    const messagesCol = db.collection("messages");
    const usersCol = db.collection("llove");

    io.on("connection", (socket) => {
      /* 🔗 JOIN CHAT */
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

      /* 💬 SEND MESSAGE */
      socket.on("sendMessage", async (data) => {
        const now = new Date();
        const message = {
          chatId: CHAT_ID,
          sender: data.sender,
          content: data.content || "",
          image: data.image || null,
          createdAt: now,
          time: now.toISOString(),
          edited: false,
        };

        const result = await messagesCol.insertOne(message);
        io.to(CHAT_ID).emit("receiveMessage", {
          ...message,
          _id: result.insertedId,
        });
      });

      /* ✏️ EDIT MESSAGE */
      socket.on("editMessage", async ({ id, content }) => {
        if (!id) return;
        await messagesCol.updateOne(
          { _id: new ObjectId(id) },
          { $set: { content, edited: true, updatedAt: new Date() } }
        );
        io.to(CHAT_ID).emit("messageEdited", { id, content });
      });

      /* ❌ DISCONNECT */
      socket.on("disconnect", () => {
        onlineUsers.delete(socket.id);
        io.to(CHAT_ID).emit(
          "updateUserStatus",
          Array.from(new Set(onlineUsers.values()))
        );
      });
    });

    /* 🔐 LOGIN */
    app.post("/login", async (req, res) => {
      const { username, password } = req.body;
      const user = await usersCol.findOne({
        username: username.toLowerCase().trim(),
        password: password.trim(),
      });

      if (!user) return res.status(401).json({ success: false });
      res.json({ success: true, name: user.username });
    });

    /* 📥 LOAD MESSAGES */
    app.get("/api/messages", async (req, res) => {
      const msgs = await messagesCol
        .find({ chatId: CHAT_ID })
        .sort({ createdAt: 1 })
        .toArray();
      res.json(msgs);
    });

    // Start server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  })
  .catch((err) => {
    console.error("❌ MongoDB error:", err);
  });