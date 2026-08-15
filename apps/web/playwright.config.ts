import{defineConfig,devices}from"@playwright/test";
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// `reuseExistingServer` will happily adopt a preview server started from another
// checkout, and then the whole suite passes or fails against a build nobody
// changed. Set PORT to give a worktree its own server.
const port=Number(process.env.PORT??4173),baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({testDir:"./tests/e2e",testMatch:"**/*.e2e.ts",fullyParallel:false,workers:1,timeout:45_000,expect:{timeout:8_000},use:{baseURL,trace:"retain-on-failure",screenshot:"only-on-failure",launchOptions:executablePath?{executablePath}:{}},// ATARANG_BACKEND_URL is emptied so the build under test has no configured
// backend to probe. Left at its default, every page load would reach for the
// real host over the network: slow, flaky, and answered by a machine that has
// nothing to do with the change being tested. Tests that want a backend route
// the base URL's own /api/v1/* instead.
webServer:{command:"bun run build && bun run preview",url:baseURL,env:{PORT:String(port),ATARANG_BACKEND_URL:""},reuseExistingServer:true,timeout:30_000},projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}},{name:"mobile-chromium",use:{...devices["Pixel 7"]}},
// A tablet on a music stand is the device this product is shaped around, and it
// is the one combination neither project above covers: a coarse pointer at a
// width wide enough for the three-pane layout. Only the shell spec runs here —
// separation and chord accuracy do not change with the pointer, and paying two
// more minutes per run for them would just get this project switched off.
{name:"tablet-chromium",testMatch:"**/shell.e2e.ts",use:{...devices["Desktop Chrome"],viewport:{width:1024,height:768},hasTouch:true}}]});
