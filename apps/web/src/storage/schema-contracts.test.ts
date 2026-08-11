import{describe,expect,test}from"bun:test";
import Ajv2020 from"ajv/dist/2020";

describe("canonical JSON Schema corpus",()=>{
  test("every committed schema compiles as JSON Schema 2020-12",async()=>{
    const root=new URL("../../../../packages/contracts/json-schema/",import.meta.url),glob=new Bun.Glob("*.json"),ajv=new Ajv2020({strict:false,validateFormats:false});
    const names:string[]=[];
    for await(const name of glob.scan({cwd:root.pathname})){const schema=await Bun.file(new URL(name,root)).json();expect(()=>ajv.compile(schema)).not.toThrow();names.push(name)}
    expect(names.sort()).toEqual(["backup-manifest-v1.json","beat-grid-v1.json","chord-analysis-v1.json","correction-layer-v1.json","lyrics-document-v1.json","model-artifact-manifest-v1.json","original-v1.json","performance-manifest-v1.json","practice-state-v1.json","separation-manifest-v1.json","user-chart-v1.json"]);
  });
});
