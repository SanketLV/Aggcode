import { WebSocketServer } from "ws";
import mongoose from "mongoose";
import { UserManager } from "./UserManager";

mongoose
  .connect(process.env.DB_URL!)
  .then(() => {
    const server = new WebSocketServer({
      port: 3000,
    });

    server.on("connection", (ws) => {
      UserManager.getInstance().addUser(ws);
    });
  })
  .catch((e) => {
    console.log(e);
  });
