const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");
const http = require("http");
const { Server } = require("socket.io");

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
          video: data.video || null,
          createdAt: now,
          time: now.toISOString(),
          edited: false, // ✅ added
        };

        const result = await messagesCol.insertOne(message);

        io.to(CHAT_ID).emit("receiveMessage", {
          ...message,
          _id: result.insertedId,
        });
      });

      /* ✏️ EDIT MESSAGE (NEW) */
      socket.on("editMessage", async ({ id, content }) => {
        if (!id || !content) return;

        await messagesCol.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              content,
              edited: true,
              updatedAt: new Date(),
            },
          }
        );

        io.to(CHAT_ID).emit("messageEdited", {
          id,
          content,
        });
      });

      /* 🗑️ SOCKET DELETE (FOR OTHER USERS) */
      socket.on("deleteMessage", (messageId) => {
        io.to(CHAT_ID).emit("messageDeleted", messageId);
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

      // ✅ ensure old messages work
      const formatted = msgs.map((m) => ({
        ...m,
        time: m.time || m.createdAt,
      }));

      res.json(formatted);
    });

    /* 🗑️ DELETE MESSAGE (HTTP) */
    app.delete("/api/messages/:id", async (req, res) => {
      try {
        const { id } = req.params;

        await messagesCol.deleteOne({ _id: new ObjectId(id) });

        io.to(CHAT_ID).emit("messageDeleted", id);

        res.json({ success: true });
      } catch (err) {
        console.error("Delete error:", err);
        res.status(500).json({ success: false });
      }
    });

    server.listen(5000, () =>
      console.log("🚀 Server running on port 5000")
    );
  })
  .catch((err) => {
    console.error("MongoDB error:", err);
  });
