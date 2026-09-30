import path from 'path'

export interface CompletedFile {
  outputPath: string
  saveRoot?: string
}

export function completionFolders(files: CompletedFile[]): string[] {
  const directories = new Map<string, string>()
  const roots = new Map<string, string>()
  const key = (directory: string) => process.platform === 'win32' ? directory.toLowerCase() : directory
  for (const file of files) {
    const directory = path.resolve(path.dirname(file.outputPath))
    let root = file.saveRoot ? path.resolve(file.saveRoot) : directory
    const relative = path.relative(root, directory)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) root = directory
    directories.set(key(directory), directory)
    roots.set(key(root), root)
  }
  return Array.from(directories.size === 1 ? directories.values() : roots.values())
}
