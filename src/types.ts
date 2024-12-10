export interface RequestSignature {
  timestamp?: string;
  sign?: string;
}

export interface LarkResponse {
  code: number;
  msg: string;
  // biome-ignore lint/suspicious/noExplicitAny: we have to use any here.
  data: any;
}
