import { WebSocketServer } from "ws";
import mongoose from "mongoose";
import { UserManager } from "./UserManager";
import { warmClaudeCatalog } from "./providers";

mongoose
  .connect(process.env.DB_URL!)
  .then(() => {
    // After the connect: the fetch needs the API key stored in Mongo. Not
    // awaited, since the model list takes seconds and the picker has a
    // fallback until it lands.
    warmClaudeCatalog();

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
