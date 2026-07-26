/**
 * Compara o conteúdo integral de dois Blobs.
 *
 * O tamanho sozinho não comprova que um documento foi persistido: duas versões
 * diferentes de um DOCX podem ter exatamente a mesma quantidade de bytes.
 */
export async function blobContentsEqual(expected: Blob, actual: Blob): Promise<boolean> {
  if (expected.size !== actual.size) return false;

  const [expectedBuffer, actualBuffer] = await Promise.all([
    expected.arrayBuffer(),
    actual.arrayBuffer(),
  ]);

  const expectedBytes = new Uint8Array(expectedBuffer);
  const actualBytes = new Uint8Array(actualBuffer);

  for (let index = 0; index < expectedBytes.length; index += 1) {
    if (expectedBytes[index] !== actualBytes[index]) return false;
  }

  return true;
}
