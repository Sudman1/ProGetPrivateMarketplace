import * as vscode from 'vscode';
import { Extension } from '../models/extension';

/**
 * Service for interacting with ProGet feeds to fetch VS Code extension packages
 *
 * IMPORTANT: ProGet VSIX feeds are designed primarily for Visual Studio consumption
 * and do not provide documented REST APIs for programmatic package discovery.
 * This service provides a basic framework but may require manual package management.
 */
export class ProGetService {
  private readonly feedUrl: string;

  constructor(feedUrl: string) {
    this.feedUrl = feedUrl.replace(/\/$/, ''); // Remove trailing slash
    // Convert feeds URL to vsix API URL if needed
    if (this.feedUrl.includes('/feeds/')) {
      this.feedUrl = this.feedUrl.replace('/feeds/', '/vsix/');
    }
  }

  /**
   * Checks if a URL is a ProGet feed URL
   * @param url - The URL to check
   * @returns True if the URL appears to be a ProGet feed
   */
  static isProGetFeedUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  /**
   * Fetches the list of packages from the ProGet feed using Atom XML
   * @returns Promise resolving to an array of package metadata
   */
  async fetchPackages(): Promise<ProGetPackage[]> {
    try {
      const atomUrl = `${this.feedUrl}/atom.xml`;
      const response = await fetch(atomUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch packages: ${response.status} ${response.statusText}`);
      }

      const xmlText = await response.text();
      const packages = this.parsePackagesFromAtom(xmlText);
      return packages;
    } catch (error) {
      console.error(`Error fetching packages from ProGet feed ${this.feedUrl}:`, error);
      vscode.window.showErrorMessage(`Failed to fetch packages from ProGet feed: ${String(error)}`);
      return [];
    }
  }

  /**
   * Parses package information from Atom XML feed
   * @param xmlText - The Atom XML content
   * @returns Array of packages found
   */
  private parsePackagesFromAtom(xmlText: string): ProGetPackage[] {
    const packages: ProGetPackage[] = [];

    try {
      // Use regex parsing since DOMParser may not be available in all VS Code contexts
      const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];

      for (const entryXml of entryMatches) {
        const idMatch = entryXml.match(/<id>([^<]+)<\/id>/);
        const titleMatch = entryXml.match(/<title[^>]*>([^<]+)<\/title>/);
        const summaryMatch = entryXml.match(/<summary[^>]*>([^<]+)<\/summary>/);
        const versionMatch = entryXml.match(/<Version>([^<]+)<\/Version>/);
        const contentMatch = entryXml.match(/<content[^>]*src="([^"]+)"/);
        const updatedMatch = entryXml.match(/<updated>([^<]+)<\/updated>/);

        if (idMatch) {
          const id = idMatch[1];
          const downloadUrl = contentMatch?.[1];

          packages.push({
            id,
            title: titleMatch?.[1] || id,
            description: summaryMatch?.[1] || '',
            authors: ['Unknown'],
            tags: [],
            latestVersion: versionMatch?.[1] || '1.0.0',
            downloadUrl: downloadUrl,
            publishedAt: updatedMatch?.[1] || new Date().toISOString(),
          });
        }
      }
    } catch (parseError) {
      console.error('Error parsing Atom XML:', parseError);
    }

    return packages;
  }

  /**
   * This method is not supported for ProGet VSIX feeds
   * @param packageId - The package identifier
   * @returns Empty array
   */
  fetchPackageVersions(packageId: string): ProGetPackageVersion[] {
    vscode.window.showWarningMessage(
      `ProGet VSIX feeds require manual package discovery. Please browse to ${this.feedUrl}/${packageId} to view available versions.`
    );
    return [];
  }

  /**
   * Downloads a specific version of a package if the download URL is known
   * @param packageId - The package identifier
   * @param version - The package version
   * @returns Promise resolving to the downloaded package buffer
   */
  async downloadPackage(packageId: string, version: string): Promise<Buffer | null> {
    try {
      const downloadUrl = `${this.feedUrl}/download/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}`;
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`Failed to download package: ${response.status} ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (error) {
      console.error(`Error downloading package ${packageId}@${version}:`, error);
      vscode.window.showErrorMessage(`Failed to download package: ${String(error)}`);
      return null;
    }
  }

  /**
   * Creates a placeholder extension object for ProGet packages
   * @param packageId - The package identifier
   * @param version - The package version
   * @returns Extension object
   */
  createExtensionFromUrl(packageId: string, version: string): Extension {
    const extension = new Extension();

    // Basic information
    extension.id = packageId;
    extension.name = packageId;
    extension.extensionPath = `${this.feedUrl}/download/${packageId}/${version}`;

    // Identity
    extension.identity.version = version;
    extension.identity.target = 'any';
    extension.identity.preRelease = false;
    extension.identity.preview = false;
    extension.identity.engine = '*';

    // Metadata
    extension.metadata.description = `Extension from ProGet feed: ${this.feedUrl}`;
    extension.metadata.publisher = 'ProGet';
    extension.metadata.publishedAt = new Date();
    extension.metadata.identifier = `proget.${packageId.toLowerCase()}`;
    extension.metadata.language = 'en-US';
    extension.metadata.categories = [];

    // Assets
    extension.assets.readme = 'This extension was loaded from a ProGet feed. Visit the feed URL for more information.';
    extension.assets.changelog = '';
    extension.assets.image = '';

    // Links
    extension.links.getStarted = '';
    extension.links.learn = '';
    extension.links.repository = '';
    extension.links.support = this.feedUrl;

    return extension;
  }

  /**
   * Converts a ProGet package to an Extension object
   * @param progetPackage - The ProGet package metadata
   * @param progetVersion - The specific version metadata
   * @returns Extension object
   */
  convertToExtension(progetPackage: ProGetPackage, progetVersion: ProGetPackageVersion): Extension {
    const extension = new Extension();

    // Basic information
    extension.id = progetPackage.id;
    extension.name = progetPackage.title || progetPackage.id;
    extension.extensionPath =
      progetVersion.downloadUrl || `${this.feedUrl}/download/${progetPackage.id}/${progetVersion.version}`;

    // Identity
    extension.identity.version = progetVersion.version;
    extension.identity.target = 'any';
    extension.identity.preRelease = false;
    extension.identity.preview = false;
    extension.identity.engine = '*';

    // Metadata
    extension.metadata.description = progetPackage.description || '';
    extension.metadata.publisher = progetPackage.authors?.[0] || 'ProGet';
    extension.metadata.publishedAt = new Date(progetVersion.published || Date.now());
    extension.metadata.identifier = `${extension.metadata.publisher.toLowerCase()}.${extension.id.toLowerCase()}`;
    extension.metadata.language = 'en-US';
    extension.metadata.categories = progetPackage.tags || [];

    // Assets
    extension.assets.readme = '';
    extension.assets.changelog = '';
    extension.assets.image = '';

    // Links
    extension.links.getStarted = '';
    extension.links.learn = '';
    extension.links.repository = progetPackage.projectUrl || '';
    extension.links.support = '';

    return extension;
  }
}

/**
 * Interface representing a package from ProGet
 */
export interface ProGetPackage {
  id: string;
  title?: string;
  description?: string;
  authors?: string[];
  tags?: string[];
  projectUrl?: string;
  iconUrl?: string;
  downloadCount?: number;
  totalDownloads?: number;
  latestVersion?: string;
  downloadUrl?: string;
  publishedAt?: string;
}

/**
 * Interface representing a package version from ProGet
 */
export interface ProGetPackageVersion {
  version: string;
  published?: string;
  downloadCount?: number;
  downloadUrl?: string;
  size?: number;
}
