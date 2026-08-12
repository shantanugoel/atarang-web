import { serveDist } from "./server";

const port = Number(Bun.env.PORT ?? 4173);
serveDist(port);
console.log(`Atarang preview listening on http://0.0.0.0:${port}`);
