export function worldOf(folder: string): string {
  return folder.split('/')[0];
}

export function isInWorld(source: string, target: string): boolean {
  return worldOf(source) === worldOf(target);
}

export function isDirectChild(parent: string, child: string): boolean {
  const suffix = child.slice(parent.length);
  return suffix.startsWith('/') && suffix.indexOf('/', 1) === -1;
}
