/**
 * Firefox (incl. Zen and other Gecko forks) often never fires the YouTube iframe
 * API `onReady` when the player sits in an opacity/visibility-hidden container.
 * Keep the embed visible there; other browsers can use an off-screen audio-only player.
 */
export function youtubeNeedsVisibleEmbed(): boolean {
  if (typeof navigator === 'undefined') return false
  return /firefox/i.test(navigator.userAgent)
}

export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'Invalid YouTube video ID.'
    case 5:
      return 'YouTube playback failed in this browser. Try attaching a local audio file instead.'
    case 100:
      return 'Video not found or removed.'
    case 101:
    case 150:
      return 'This video cannot be embedded here. Attach a local audio file, or watch on YouTube.'
    default:
      return 'YouTube playback unavailable. Try attaching a local audio file.'
  }
}
