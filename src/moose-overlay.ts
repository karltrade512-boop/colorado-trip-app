import raw from "../public/extras-moose.json";
import { parseMooseOverlay, type MooseOverlay } from "./bundle";

export const mooseOverlay: MooseOverlay = parseMooseOverlay(raw);
