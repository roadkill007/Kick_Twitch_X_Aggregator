export interface XLivestreamConfig {
  livestreamUrl: string;
}

export function assertXLivestreamConfigured(config: XLivestreamConfig): void {
  if (!config.livestreamUrl || config.livestreamUrl.toLowerCase() === 'none') {
    throw new Error('X livestream URL is required before enabling the X provider');
  }
}
