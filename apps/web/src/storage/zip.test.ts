import{describe,expect,test}from"bun:test";
import{createStoredZip,readStoredZip}from"./zip";
describe("stored ZIP backup",()=>{test("round trips named entries and verifies CRC",async()=>{const archive=await createStoredZip([{name:"manifest.json",blob:new Blob(["hello"])},{name:"audio/mic.wav",blob:new Blob([new Uint8Array([1,2,3])])}]),entries=await readStoredZip(archive);expect(await entries.get("manifest.json")!.text()).toBe("hello");expect(new Uint8Array(await entries.get("audio/mic.wav")!.arrayBuffer())).toEqual(new Uint8Array([1,2,3]))})});
