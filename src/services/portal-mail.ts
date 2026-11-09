export interface PortalMail {
  to: string;
  kind: "verify" | "reset" | "invite";
  token: string;
  expiresAt: number;
}

// Inject a delivery adapter at application composition. Tokens go only to that adapter.
export interface PortalMailer {
  send(message: PortalMail): Promise<void>;
}
