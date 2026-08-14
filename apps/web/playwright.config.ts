import{defineConfig,devices}from"@playwright/test";
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// `reuseExistingServer` will happily adopt a preview server started from another
// checkout, and then the whole suite passes or fails against a build nobody
// changed. Set PORT to give a worktree its own server.
const port=Number(process.env.PORT??4173),baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({testDir:"./tests/e2e",testMatch:"**/*.e2e.ts",fullyParallel:false,workers:1,timeout:45_000,expect:{timeout:8_000},use:{baseURL,trace:"retain-on-failure",screenshot:"only-on-failure",launchOptions:executablePath?{executablePath}:{}},webServer:{command:"bun run build && bun run preview",url:baseURL,env:{PORT:String(port)},reuseExistingServer:true,timeout:30_000},projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}},{name:"mobile-chromium",use:{...devices["Pixel 7"]}}]});
