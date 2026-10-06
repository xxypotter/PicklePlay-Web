import { MLP_MAX_COURTS } from "@/lib/mlp/rules";
import { SWISS_MAX_COURTS } from "@/lib/swiss/engine";

export const MAX_COURTS = 4;
export const PLAYERS_PER_COURT = 6;
export const maxCourtsFor = (format: string) =>
  format === "mlp" ? MLP_MAX_COURTS : format === "swiss" ? SWISS_MAX_COURTS : MAX_COURTS;
