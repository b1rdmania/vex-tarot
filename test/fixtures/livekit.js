export const RoomEvent = Object.fromEntries(["TrackSubscribed", "TrackUnsubscribed", "DataReceived", "Disconnected", "ParticipantDisconnected", "Reconnecting", "Reconnected"].map(x => [x, x]));
export const Track = { Kind: { Video: "video", Audio: "audio" } };
const mock = window.__vexMock = { rooms: [], disconnects: 0, sent: [], data: [] };
export class Room {
  handlers = new Map();
  localParticipant = { identity: "guest", setMicrophoneEnabled: async () => {
    if (window.__micDenied) throw new DOMException("Denied", "NotAllowedError");
  }, sendText: async (text, options) => { mock.sent.push({ text, topic: options?.topic }); },
  publishData: async (payload, options) => { mock.data.push({ text: new TextDecoder().decode(payload), topic: options?.topic }); } };
  constructor() { mock.rooms.push(this); }
  on(name, fn) { this.handlers.set(name, fn); }
  registerTextStreamHandler(_name, fn) { this.transcribe = fn; }
  async connect() {}
  async disconnect() { mock.disconnects++; this.handlers.get("Disconnected")?.(); }
  event(msg) { this.handlers.get("DataReceived")?.(new TextEncoder().encode(JSON.stringify(msg)), { identity: "vex-agent" }, null, "vex"); }
  async say(text) { await this.transcribe((async function* () { yield text; })(), { identity: "vex-agent" }); }
}
mock.event = msg => mock.rooms.at(-1).event(msg);
mock.say = text => mock.rooms.at(-1).say(text);
