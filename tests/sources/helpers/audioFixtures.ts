/**
 * A File that passes the add-song audio validation.
 *
 * The flows now read the container signature, because a browser types a file by
 * its extension — so `new File(['x'], 'song.mp3')` is exactly the "garbage
 * renamed to .mp3" case they reject. This leads with a valid MPEG frame sync
 * (0xFF 0xFB …) so the fixture represents a real audio file.
 */
export function mp3File(parts: BlobPart[] = [new Uint8Array([0, 0, 0, 0])], name = 'song.mp3'): File {
  return new File([new Uint8Array([0xff, 0xfb, 0x90, 0x00]), ...parts], name, { type: 'audio/mpeg' })
}
