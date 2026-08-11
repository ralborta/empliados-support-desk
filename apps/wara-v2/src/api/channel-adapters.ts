/**
 * Adaptadores de canal — solo fake/local. Sin BBC/WhatsApp/BuilderBot.
 */
export type ChannelAdapter = {
  readonly name: string;
  readonly real: false;
  send?(payload: unknown): Promise<never>;
};

export const LocalFakeChannel: ChannelAdapter = {
  name: "local-fake-channel",
  real: false,
  async send() {
    throw new Error("channel_delivery_disabled");
  },
};

export const REAL_CHANNELS = [] as const;

export function assertNoRealChannels(): void {
  if (process.env.REAL_CHANNELS_ENABLED === "true") {
    throw new Error("REAL_CHANNELS_ENABLED_forbidden_in_phase7");
  }
  if (REAL_CHANNELS.length > 0) {
    throw new Error("real_channel_registered");
  }
}
