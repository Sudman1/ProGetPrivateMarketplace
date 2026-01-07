import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

import { CONSTANTS } from '../constants';
import { Package } from '../models/package';
import { getExtensionSources, getPackages } from '../utils';

export class TreeViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | void> = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;
  private iconCache = new Map<string, string>(); // Cache for downloaded icons
  private context?: vscode.ExtensionContext;

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }
  
  getChildren(): Thenable<TreeNode[]> {
    return this.getData();
  }

  async getData(): Promise<TreeNode[]> {
    const packages = await getPackages(getExtensionSources() || []);
    vscode.commands.executeCommand(CONSTANTS.cmdUpdateBadge, packages);
    
    // Pre-process icons for packages with remote URLs
    const treeNodes = await Promise.all(packages.map(async pkg => {
      if (pkg.extension.assets.image && 
          (pkg.extension.assets.image.startsWith('http://') || pkg.extension.assets.image.startsWith('https://'))) {
        await this.cacheRemoteIcon(pkg);
      }
      return new TreeNode(pkg, this);
    }));
    
    return treeNodes;
  }

  /**
   * Downloads and caches a remote icon as a data URL
   */
  private async cacheRemoteIcon(pkg: Package): Promise<void> {
    const iconUrl = pkg.extension.assets.image;
    if (!iconUrl || this.iconCache.has(iconUrl)) {
      return; // Already cached or no icon
    }

    try {
      console.log(`Downloading icon for ${pkg.id} from: ${iconUrl}`);
      
      const response = await fetch(iconUrl);
      if (!response.ok) {
        console.warn(`Failed to download icon for ${pkg.id}: ${response.status}`);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Determine MIME type from response headers or URL extension
      let mimeType = response.headers.get('content-type') || 'image/png';
      if (!mimeType.startsWith('image/')) {
        // Guess from URL extension
        if (iconUrl.toLowerCase().includes('.svg')) {
          mimeType = 'image/svg+xml';
        } else if (iconUrl.toLowerCase().includes('.jpg') || iconUrl.toLowerCase().includes('.jpeg')) {
          mimeType = 'image/jpeg';
        } else {
          mimeType = 'image/png';
        }
      }

      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      
      // Cache the data URL and update the extension's image asset
      this.iconCache.set(iconUrl, dataUrl);
      pkg.extension.assets.image = dataUrl;
      
      console.log(`Cached icon for ${pkg.id} as data URL (${buffer.length} bytes)`);
    } catch (error) {
      console.warn(`Failed to cache icon for ${pkg.id}:`, error);
    }
  }
}

class TreeNode extends vscode.TreeItem {
  public readonly package: Package;
  private treeProvider: TreeViewProvider;

  constructor(pkg: Package, treeProvider: TreeViewProvider) {
    super(pkg.extension.name, vscode.TreeItemCollapsibleState.None);
    this.package = pkg;
    this.treeProvider = treeProvider;
    this.id = pkg.id;
    
    // Use extension icon if available, otherwise fall back to theme icon
    this.iconPath = this.getIconPath(pkg);
    
    this.command = {
      command: CONSTANTS.cmdView,
      title: '',
      arguments: [pkg],
    };
    this.description = pkg.installedVersion ? (pkg.isUpdateAvailable() ? 'Update Available' : 'Up-to-Date') : '';
    this.tooltip = pkg.extension.metadata.description;
    this.contextValue = !pkg.installedVersion ? 'install' : pkg.isUpdateAvailable() ? 'update' : 'uninstall';
  }

  private getIconPath(pkg: Package): vscode.Uri | vscode.ThemeIcon {
    const imageAsset = pkg.extension.assets.image;
    
    if (!imageAsset) {
      console.log(`No icon for ${pkg.id}`);
      return this.getThemeIcon(pkg);
    }

    console.log(`Icon for ${pkg.id}: ${imageAsset.startsWith('data:') ? 'data URL' : imageAsset}`);

    try {
      if (imageAsset.startsWith('data:image/')) {
        // Base64 data URL - VS Code supports these directly in tree views
        console.log(`Using data URL icon for ${pkg.id}`);
        return vscode.Uri.parse(imageAsset);
      } else if (imageAsset.startsWith('file://') || (!imageAsset.startsWith('http'))) {
        // Local file path
        console.log(`Using local file icon for ${pkg.id}: ${imageAsset}`);
        return vscode.Uri.file(imageAsset.replace('file://', ''));
      } else {
        // This should not happen now since we convert remote URLs to data URLs
        console.warn(`Unexpected icon format for ${pkg.id}: ${imageAsset}`);
        return this.getThemeIcon(pkg);
      }
    } catch (error) {
      console.warn(`Failed to parse icon path for ${pkg.id}: ${imageAsset}`, error);
      return this.getThemeIcon(pkg);
    }
  }

  private getThemeIcon(pkg: Package): vscode.ThemeIcon {
    return new vscode.ThemeIcon(
      'extensions',
      pkg.isUpdateAvailable() ? new vscode.ThemeColor('privateMarketplace.updateIconColor') : undefined
    );
  }
}
