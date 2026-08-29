import mongoose, { Schema } from "mongoose";

// Mirrors the `Message` wire type in commons/types so no field mapping is needed.
// Mirrors MessagePart in commons/types. `text` and `name`/`detail` are both
// optional here because the two part kinds share one subdocument shape.
const MessagePart = new Schema(
  {
    type: { type: String, enum: ["text", "tool"], required: true },
    text: String,
    // Named `toolId` rather than `id` to stay clear of mongoose's `id` virtual.
    toolId: String,
    name: String,
    detail: String,
    status: { type: String, enum: ["running", "done", "error"] },
    output: String,
  },
  { _id: false },
);

const Message = new Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    payload: {
      message: { type: String, required: true },
      parts: { type: [MessagePart], default: undefined },
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
  anthropicSessionId: String,
});

export const WorkspaceModel = mongoose.model("Workspace", Workspace);
export const SessionModel = mongoose.model("Session", Session);
