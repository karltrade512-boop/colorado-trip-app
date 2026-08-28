import { registerSW } from "virtual:pwa-register";
import { start } from "./app";
import "./style.css";

registerSW({ immediate: true });
void start();
