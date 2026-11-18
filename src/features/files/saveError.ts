/** The real reason from the phone (or the link step), not a generic "check your connection". */
export function saveErrorMessage(error: unknown, isNative: boolean) {
  const reason = error instanceof Error ? error.message.trim() : '';
  const prefix = isNative ? 'Couldn’t save the file to your phone' : 'Couldn’t download the file';

  return reason ? `${prefix}: ${reason}` : `${prefix}. Please try again.`;
}
