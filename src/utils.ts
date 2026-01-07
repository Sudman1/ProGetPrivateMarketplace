import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import xml2js from 'xml2js';

import { CONSTANTS } from './constants';
import { Extension } from './models/extension';
import { Package } from './models/package';
import { ProGetService } from './services/progetService';
import { Manifest } from './types/XmlManifest';
import { PackageJson } from './types/PackageJson';

/**
 * Recursively gets paths of extensions inside a directory.
 * @param dir - The directory to start searching for extensions.
 * @param depth - The depth of recursion.
 * @param extensionPaths - Array to store found extension paths.
 * @returns An array of extension paths.
 */
const getExtensionPathsRecursively = (dir: string, depth: number, extensionPaths: string[] = []): string[] => {
  if (depth <= 0) {
    return extensionPaths;
  }

  try {
    const contents = fs.readdirSync(dir, { withFileTypes: true });

    for (const content of contents) {
      const fullPath = path.join(dir, content.name);

      if (content.isDirectory()) {
        extensionPaths = getExtensionPathsRecursively(fullPath, depth - 1, extensionPaths);
      } else if (content.name.endsWith('.vsix')) {
        extensionPaths.push(fullPath);
      }
    }
  } catch (err) {
    console.log(err);
  }

  return extensionPaths;
};

/**
 * Gets the list of packages (collections of extensions) from sources.
 * @param sources - Array of sources (directory paths or ProGet feed URLs).
 * @returns A promise resolving to an array of packages.
 */
export const getPackages = async (sources: string[]): Promise<Package[]> => {
  const packages: Package[] = [];
  const extensions = await getExtensions(sources);
  if (!extensions?.length) return [];

  for (const extension of extensions) {
    let packageIndex = packages.findIndex((x) => x.id === extension.id);
    if (packageIndex === -1) {
      const pkg = new Package();
      pkg.id = extension.id;
      pkg.installedVersion = getExtensionInstalledVersion(extension.metadata.identifier);
      packages.push(pkg);
      packageIndex = packages.length - 1;
    }

    packages[packageIndex].addExtension(extension);
  }

  packages.map((x) => x.sort());

  return packages;
};

/**
 * Gets the list of extensions from sources (local directories and ProGet feeds).
 * @param sources - Array of sources (directory paths or ProGet feed URLs).
 * @returns A promise resolving to an array of extensions.
 */
const getExtensions = async (sources: string[]): Promise<Extension[]> => {
  const extensions: Extension[] = [];
  
  // Separate local directories from ProGet feed URLs
  const localDirs = sources.filter(source => !ProGetService.isProGetFeedUrl(source));
  const feedUrls = sources.filter(source => ProGetService.isProGetFeedUrl(source));

  // Process local directories (existing logic)
  const localExtensions = await getExtensionsFromLocalDirectories(localDirs);
  extensions.push(...localExtensions);

  // Process ProGet feeds
  for (const feedUrl of feedUrls) {
    const feedExtensions = await getExtensionsFromProGetFeed(feedUrl);
    extensions.push(...feedExtensions);
  }

  return extensions;
};

/**
 * Gets extensions from local directories (original logic).
 * @param dirs - Array of local directory paths.
 * @returns A promise resolving to an array of extensions.
 */
const getExtensionsFromLocalDirectories = async (dirs: string[]): Promise<Extension[]> => {
  const extensionPaths = dirs.map((dir) => getExtensionPathsRecursively(dir, 3)).flat();
  const extensions: Extension[] = [];
  const parser = new xml2js.Parser({ explicitArray: false });

  for (const extensionPath of extensionPaths) {
    try {
      const zip = new AdmZip(extensionPath);
      const extManifest = (await parser.parseStringPromise(zip.readAsText('extension.vsixmanifest'))) as Manifest;
      const npmManifest = JSON.parse(zip.readAsText('extension/package.json')) as PackageJson;
      const extension = new Extension();

      const PackageManifest = extManifest?.PackageManifest;
      if (!PackageManifest) continue;

      extension.identity.target = PackageManifest.Metadata?.Identity?.$?.TargetPlatform || 'any';
      if (!isCompatibleTarget(extension.identity.target)) continue;

      /* BASE */
      extension.name = PackageManifest.Metadata?.DisplayName;
      extension.id = PackageManifest.Metadata?.Identity?.$?.Id;
      extension.extensionPath = extensionPath;

      const propertiesArray = PackageManifest.Metadata?.Properties?.Property || [];

      /* IDENTIFY */
      extension.identity.version = PackageManifest.Metadata?.Identity?.$?.Version;
      extension.identity.preRelease = !!propertiesArray.find(
        (prop) => prop?.$?.Id === 'Microsoft.VisualStudio.Code.PreRelease'
      );
      extension.identity.preview = npmManifest?.preview;
      extension.identity.engine = npmManifest?.engines?.vscode || '*';

      /* METADATA */
      extension.metadata.description = PackageManifest.Metadata?.Description?._;
      extension.metadata.publisher = PackageManifest.Metadata?.Identity?.$?.Publisher;
      extension.metadata.publishedAt = fs.statSync(extensionPath).ctime;
      extension.metadata.identifier = `${extension.metadata.publisher.toLowerCase()}.${extension.id.toLowerCase()}`;
      extension.metadata.language = PackageManifest.Metadata?.Identity?.$?.Language || 'en-US';
      extension.metadata.categories = npmManifest.categories || [];

      /* ASSETS */
      const readmePath = PackageManifest.Assets?.Asset?.find(
        (asset) => asset?.$?.Type === 'Microsoft.VisualStudio.Services.Content.Details'
      )?.$?.Path;
      const changelogPath = PackageManifest.Assets?.Asset?.find(
        (asset) => asset?.$?.Type === 'Microsoft.VisualStudio.Services.Content.Changelog'
      )?.$?.Path;
      const imagePath = PackageManifest.Metadata?.Icon;

      extension.assets.readme = readmePath ? zip.readAsText(readmePath) : '';
      extension.assets.changelog = changelogPath ? zip.readAsText(changelogPath) : '';
      extension.assets.image = imagePath
        ? `data:image/png;base64,${(zip.readFile(imagePath) as Buffer).toString('base64')}`
        : '';

      /* LINKS */
      extension.links.getStarted = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Getstarted'))?.$?.Value || '';
      extension.links.learn = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Learn'))?.$?.Value || '';
      extension.links.repository = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Repository'))?.$?.Value || '';
      extension.links.support = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Support'))?.$?.Value || '';

      extensions.push(extension);
    } catch (error) {
      console.error(`Error processing extension ${extensionPath}:`, error);
    }
  }

  return extensions;
};

/**
 * Gets extensions from a ProGet feed.
 * @param feedUrl - The ProGet feed URL.
 * @returns A promise resolving to an array of extensions.
 */
const getExtensionsFromProGetFeed = async (feedUrl: string): Promise<Extension[]> => {
  const extensions: Extension[] = [];
  
  try {
    const progetService = new ProGetService(feedUrl);
    const packages = await progetService.fetchPackages();

    for (const pkg of packages) {
      // Create an extension from the rich metadata provided by ProGet
      const extension = new Extension();
      
      // Basic information
      extension.id = pkg.id;
      extension.name = pkg.title || pkg.id;
      extension.extensionPath = pkg.downloadUrl || `${feedUrl}/download/${pkg.id}/${pkg.latestVersion}`;

      // Identity
      extension.identity.version = pkg.latestVersion || '1.0.0';
      extension.identity.target = pkg.targetPlatform || 'any';
      extension.identity.preRelease = false; // Could be enhanced to detect prerelease versions
      extension.identity.preview = false;
      extension.identity.engine = '*'; // Default engine

      // Metadata
      extension.metadata.description = pkg.description || '';
      extension.metadata.publisher = pkg.authors?.[0] || 'ProGet';
      extension.metadata.publishedAt = pkg.publishedAt ? new Date(pkg.publishedAt) : new Date();
      extension.metadata.identifier = `${extension.metadata.publisher.toLowerCase()}.${extension.id.toLowerCase()}`;
      extension.metadata.language = 'en-US';
      extension.metadata.categories = pkg.tags || [];

      // Assets - Use icon from ProGet if available
      extension.assets.readme = pkg.description ? 
        `# ${pkg.title || pkg.id}\n\n${pkg.description}\n\n**Publisher:** ${pkg.authors?.[0] || 'Unknown'}\n**Version:** ${pkg.latestVersion}\n**Downloads:** ${pkg.downloadCount || 0}${pkg.rating ? `\n**Rating:** ${pkg.rating} (${pkg.ratingCount || 0} reviews)` : ''}\n\nExtension loaded from ProGet feed.` :
        'Extension from ProGet feed. Download to view detailed information.';
      extension.assets.changelog = '';
      
      // Handle icon URL - convert relative URLs to absolute
      if (pkg.iconUrl) {
        if (pkg.iconUrl.startsWith('/')) {
          // Relative URL - construct absolute URL
          // Extract base URL (protocol + host + port) from feedUrl
          try {
            const feedUrlObj = new URL(feedUrl);
            const baseUrl = `${feedUrlObj.protocol}//${feedUrlObj.host}`;
            extension.assets.image = `${baseUrl}${pkg.iconUrl}`;
          } catch {
            // Fallback if URL parsing fails
            const baseUrl = feedUrl.split('/vsix/')[0] || feedUrl.split('/feeds/')[0] || 'http://localhost:8624';
            extension.assets.image = `${baseUrl}${pkg.iconUrl}`;
          }
        } else {
          extension.assets.image = pkg.iconUrl;
        }
      } else {
        extension.assets.image = '';
      }

      // Links
      extension.links.getStarted = '';
      extension.links.learn = '';
      extension.links.repository = pkg.moreInfoUrl || pkg.projectUrl || '';
      extension.links.support = feedUrl;

      // Check if platform is compatible
      if (!isCompatibleTarget(extension.identity.target)) continue;
      
      extensions.push(extension);
    }
  } catch (error) {
    console.error(`Error fetching extensions from ProGet feed ${feedUrl}:`, error);
    vscode.window.showErrorMessage(`Failed to fetch extensions from ProGet feed: ${String(error)}`);
  }

  return extensions;
};

/**
 * Checks if the extension target is compatible with the current platform.
 * @param target - The target platform of the extension.
 * @returns True if the target is compatible; otherwise, false.
 */
const isCompatibleTarget = (target: string): boolean => {
  const targetPlatform = `${process.platform}-${process.arch}`;
  if (target === 'any' || targetPlatform.toLowerCase() === target.toLowerCase()) {
    return true;
  }
  return false;
};

/**
 * Gets the installed version of an extension using its identifier.
 * @param identifier - The identifier of the extension.
 * @returns The installed version of the extension.
 */
const getExtensionInstalledVersion = (identifier: string): string => {
  const ext = vscode.extensions.getExtension(identifier);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return ext?.packageJSON?.version;
};

/**
 * Installs an extension from a package.
 * @param pkg - The package containing the extension to install.
 * @param ctx - The VSCode extension context.
 * @returns A promise resolving to the installed version of the extension.
 */
export const installExtension = async (pkg: Package, ctx: vscode.ExtensionContext): Promise<string> => {
  const downloadDir = downloadDirectoryExists(ctx);
  let copiedExtensionPath: string;
  let shouldCleanup = true;

  // Check if this is a remote package (from ProGet feed)
  if (ProGetService.isProGetFeedUrl(pkg.extension.extensionPath) || 
      pkg.extension.extensionPath.startsWith('http')) {
    // Download the package from ProGet feed
    const downloadedBuffer = await downloadRemotePackage(pkg.extension.extensionPath);
    if (!downloadedBuffer) {
      await vscode.window.showErrorMessage(
        `Failed to download ${pkg.extension.id}:v${pkg.extension.identity.version} from remote source`
      );
      return '';
    }

    // Save the downloaded package to temp directory
    copiedExtensionPath = path.join(downloadDir, `${pkg.extension.id}-${pkg.extension.identity.version}.vsix`);
    fs.writeFileSync(copiedExtensionPath, new Uint8Array(downloadedBuffer));
  } else {
    // Local file installation (existing logic)
    if (!fs.existsSync(pkg.extension.extensionPath)) {
      await vscode.window.showErrorMessage(
        `Failed to install ${pkg.extension.id}:v${pkg.extension.identity.version} vsix file doesn't exist`
      );
      return '';
    }

    // Copy extension to the download directory
    copiedExtensionPath = path.join(downloadDir, path.basename(pkg.extension.extensionPath));
    fs.copyFileSync(pkg.extension.extensionPath, copiedExtensionPath);
  }

  try {
    // Install the extension
    await vscode.commands.executeCommand(CONSTANTS.vsCmdInstall, vscode.Uri.file(copiedExtensionPath));

    // Cleanup
    if (shouldCleanup && fs.existsSync(copiedExtensionPath)) {
      fs.rmSync(copiedExtensionPath);
    }

    vscode.window.showInformationMessage(
      `Successfully installed ${pkg.extension.id}:v${pkg.extension.identity.version}`
    );
    return pkg.extension.identity.version;
  } catch (err: unknown) {
    console.error(err);
    await vscode.window.showErrorMessage(
      `Failed to install ${pkg.extension.id}:v${pkg.extension.identity.version} with error ${String(err)}`
    );
    
    // Cleanup on error
    if (shouldCleanup && fs.existsSync(copiedExtensionPath)) {
      fs.rmSync(copiedExtensionPath);
    }
  }

  return '';
};

/**
 * Downloads a package from a remote URL.
 * @param url - The URL to download the package from.
 * @returns A promise resolving to the package buffer or null if failed.
 */
async function downloadRemotePackage(url: string): Promise<Buffer | null> {
  try {
    let downloadUrl = url;
    
    // Handle relative URLs from ProGet
    if (url.startsWith('/')) {
      // For relative URLs, we need to construct the full URL
      // Default to localhost:8624 but this could be made configurable
      downloadUrl = `http://localhost:8624${url}`;
    }
    
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } catch (error) {
    console.error(`Error downloading package from ${url}:`, error);
    return null;
  }
}

/**
 * Batch updates a list of VS Code extensions.
 *
 * @param {Package[]} pkgs - The list of packages to update.
 * @param {vscode.ExtensionContext} ctx - The VS Code extension context.
 * @returns {Promise<void>} A promise that resolves once the batch update is complete.
 */
export const batchUpdateExtensions = async (pkgs: Package[], ctx: vscode.ExtensionContext): Promise<void> => {
  const downloadDir = downloadDirectoryExists(ctx);
  const failedIds = ((await vscode.workspace.getConfiguration('')?.get(CONSTANTS.propFailedUpdates)) as string[]) || [];
  let updated = 0;

  for (const pkg of pkgs) {
    if (failedIds.includes(pkg.extension.id + pkg.extension.identity.version)) continue;
    pkg.selectedIndex = 0; //latest version
    
    let copiedExtensionPath: string;

    try {
      // Check if this is a remote package
      if (ProGetService.isProGetFeedUrl(pkg.extension.extensionPath) || 
          pkg.extension.extensionPath.startsWith('http')) {
        // Download the package from ProGet feed
        const downloadedBuffer = await downloadRemotePackage(pkg.extension.extensionPath);
        if (!downloadedBuffer) {
          throw new Error('Failed to download remote package');
        }

        copiedExtensionPath = path.join(downloadDir, `${pkg.extension.id}-${pkg.extension.identity.version}.vsix`);
        fs.writeFileSync(copiedExtensionPath, new Uint8Array(downloadedBuffer));
      } else {
        // Local file
        copiedExtensionPath = path.join(downloadDir, path.basename(pkg.extension.extensionPath));
        fs.copyFileSync(pkg.extension.extensionPath, copiedExtensionPath);
      }

      console.log(copiedExtensionPath);
      // Install the extension
      await vscode.commands.executeCommand(CONSTANTS.vsCmdInstall, vscode.Uri.file(copiedExtensionPath));
      // Cleanup
      fs.rmSync(copiedExtensionPath);
      updated++;
    } catch (err: unknown) {
      console.error(err);
      await vscode.window.showErrorMessage(
        `Failed to install ${pkg.extension.id}:v${pkg.extension.identity.version} with error ${String(err)}`
      );
      failedIds.push(pkg.extension.id + pkg.extension.identity.version);
    }
  }

  if (failedIds.length)
    await vscode.workspace
      .getConfiguration('')
      ?.update(CONSTANTS.propFailedUpdates, failedIds, vscode.ConfigurationTarget.Global);
  if (updated) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
};

/**
 * Uninstalls an extension.
 * @param pkg - The package containing the extension to uninstall.
 * @returns A promise resolving to true if uninstallation is successful; otherwise, false.
 */
export const uninstallExtension = async (pkg: Package): Promise<boolean> => {
  try {
    // Uninstall the extension
    await vscode.commands.executeCommand(CONSTANTS.vsCmdUninstall, pkg.extension.metadata.identifier);

    vscode.window.showInformationMessage(`Successfully uninstalled ${pkg.extension.id}:v${pkg.installedVersion}`);
    return true;
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Failed to uninstall ${pkg.extension.id}:v${pkg.installedVersion} with error ${String(err)}`
    );
  }
  return false;
};

/**
 * Checks if the download directory exists and creates it if necessary.
 * @param ctx - The VSCode extension context.
 * @returns The path to the download directory.
 */
const downloadDirectoryExists = (ctx: vscode.ExtensionContext): string => {
  const downloadDir = vscode.Uri.joinPath(ctx.globalStorageUri, 'temp');

  if (!fs.existsSync(downloadDir.fsPath)) {
    fs.mkdirSync(downloadDir.fsPath, { recursive: true });
  }

  return downloadDir.fsPath;
};

/**
 * Resolves VSCode variables like ${workspaceFolder} in a given path.
 * @param inputPath The path that may contain VSCode variables.
 * @returns The path with VSCode variables resolved to actual values.
 */
const resolveVariables = (inputPath: string): string => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

  const replacements: { [key: string]: string } = {
    '${workspaceFolder}': workspaceFolder,
  };

  return inputPath.replace(/\$\{[^}]+\}/g, (match) => replacements[match] || match);
};

/**
 * Gets the extension sources configured in VSCode settings.
 * @returns an array of extension source paths.
 */
export const getExtensionSources = (): string[] => {
  const paths = vscode.workspace.getConfiguration('').get<string[]>(CONSTANTS.propSource) || [];
  return paths.map(resolveVariables);
};

export const getWebviewOptions = (extensionUri: vscode.Uri): vscode.WebviewOptions => {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'out')],
  };
};
