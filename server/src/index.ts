import http from "http";
import app from "./app.js";
import { env } from "./env.js";
import { startWorkers } from "./common/queue/workers.js";


const start = () => {
    const Server = http.createServer(app)
    const PORT: number = env.PORT;
    Server.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
    });
    startWorkers();
}

start()