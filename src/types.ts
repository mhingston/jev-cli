import type { JevAnswer } from "./answers.js";

export interface SystemOneRequest {
  model?: string;
  state: unknown;
  questions: unknown;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface SystemOneLikeClient {
  systemOne(request: SystemOneRequest): Promise<SystemOneResponse>;
}
