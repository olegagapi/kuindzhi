// The app's session store, backed by the documents folder (kept by the OS, unlike the cache).
import { Directory, File, Paths } from 'expo-file-system';

import { createSessionStore, type Storage } from './sessionStore';

const expoStorage: Storage = {
  async readText(path) {
    const file = new File(Paths.document, path);
    return file.exists ? file.text() : null;
  },
  writeText(path, text) {
    const file = new File(Paths.document, path);
    file.parentDirectory.create({ intermediates: true, idempotent: true });
    file.write(text);
  },
  async copyFile(fromUri, toPath) {
    const destination = new File(Paths.document, toPath);
    destination.parentDirectory.create({ intermediates: true, idempotent: true });
    if (destination.exists) destination.delete();
    await new File(fromUri).copy(destination);
  },
  listDirs(path) {
    const dir = new Directory(Paths.document, path);
    if (!dir.exists) return [];
    return dir.list().flatMap((entry) => (entry instanceof Directory ? [entry.name] : []));
  },
  remove(path) {
    const dir = new Directory(Paths.document, path);
    if (dir.exists) {
      dir.delete();
      return;
    }
    const file = new File(Paths.document, path);
    if (file.exists) file.delete();
  },
  uri(path) {
    return new File(Paths.document, path).uri;
  },
};

export const sessions = createSessionStore(expoStorage);
