import mongoose, { Schema } from "mongoose";

// Mirrors the `Message` wire type in commons/types so no field mapping is needed.
const Message = new Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    payload: {
      message: { type: String, required: true },
    },
  },
  { _id: false },
);

export const Workspace = new Schema({
  path: { type: String, required: true },
  name: { type: String, required: true },
});

export const Session = new Schema({
  workspace: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
  messages: { type: [Message], default: [] },
});

export const WorkspaceModel = mongoose.model("Workspace", Workspace);
export const SessionModel = mongoose.model("Session", Session);
