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
  private readonly atomFeedUrl: string;

  constructor(atomFeedUrl: string) {
    this.atomFeedUrl = atomFeedUrl;
  }

  /**
   * Derives the base feed URL from the atom feed URL
   * @returns The base feed URL for download operations
   */
  private getBaseFeedUrl(): string {
    // Convert atom.xml URL back to base feed URL
    // e.g., http://localhost:8624/vsix/vscode-extensions/atom.xml -> http://localhost:8624/vsix/vscode-extensions
    return this.atomFeedUrl.replace('/atom.xml', '');
  }

  /**
   * Checks if a URL is a ProGet atom feed URL
   * @param url - The URL to check
   * @returns True if the URL appears to be a ProGet atom feed
   */
  static isProGetFeedUrl(url: string): boolean {
    return url.toLowerCase().includes('atom.xml') || url.includes('/feeds/') || url.includes('/vsix/');
  }

  /**
   * Fetches the list of packages from the ProGet atom feed
   * @returns Promise resolving to an array of package metadata
   */
  async fetchPackages(): Promise<ProGetPackage[]> {
    try {
      console.log(`Fetching packages from ProGet atom feed: ${this.atomFeedUrl}`);
      const response = await fetch(this.atomFeedUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch packages: ${response.status} ${response.statusText}`);
      }

      const xmlText = await response.text();
      const packages = this.parsePackagesFromAtom(xmlText);
      return packages;
    } catch (error) {
      console.error(`Error fetching packages from ProGet feed ${this.atomFeedUrl}:`, error);
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
        // Basic entry information
        const idMatch = entryXml.match(/<id>([^<]+)<\/id>/);
        const titleMatch = entryXml.match(/<title[^>]*>([^<]+)<\/title>/);
        const summaryMatch = entryXml.match(/<summary[^>]*>([^<]+)<\/summary>/);
        const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/);
        const updatedMatch = entryXml.match(/<updated>([^<]+)<\/updated>/);
        
        // Author information
        const authorMatch = entryXml.match(/<author>\s*<name>([^<]+)<\/name>\s*<\/author>/);
        
        // Links
        const iconLinkMatch = entryXml.match(/<link rel="icon" href="([^"]+)"/);
        const previewImageMatch = entryXml.match(/<link rel="previewimage" href="([^"]+)"/);
        const contentMatch = entryXml.match(/<content[^>]*src="([^"]+)"/);
        
        // VSIX namespace elements (contain detailed metadata)

        const versionMatch = entryXml.match(/<Version>([^<]+)<\/Version>/);
        const downloadCountMatch = entryXml.match(/<DownloadCount>([^<]+)<\/DownloadCount>/);
        const ratingMatch = entryXml.match(/<Rating[^>]*>([^<]+)<\/Rating>/);
        const ratingCountMatch = entryXml.match(/<RatingCount[^>]*>([^<]+)<\/RatingCount>/);
        
        // Extract additional metadata that might be present
        const displayNameMatch = entryXml.match(/<DisplayName>([^<]+)<\/DisplayName>/);
        const publisherMatch = entryXml.match(/<Publisher>([^<]+)<\/Publisher>/);
        const categoryMatch = entryXml.match(/<Categories>([^<]+)<\/Categories>/);
        const tagsMatch = entryXml.match(/<Tags>([^<]+)<\/Tags>/);
        const licenseMatch = entryXml.match(/<License>([^<]+)<\/License>/);
        const moreInfoMatch = entryXml.match(/<MoreInfo>([^<]+)<\/MoreInfo>/);
        const installationTargetMatch = entryXml.match(/<InstallationTarget[^>]*Id="([^"]+)"/);

        if (idMatch) {
          const id = idMatch[1];
          const downloadUrl = contentMatch?.[1];
          const iconUrl = iconLinkMatch?.[1];
          const previewImageUrl = previewImageMatch?.[1];
          
          // Parse categories and tags
          const categories = categoryMatch?.[1]?.split(',').map(c => c.trim()).filter(c => c) || [];
          const tags = tagsMatch?.[1]?.split(',').map(t => t.trim()).filter(t => t) || [];
          
          // Determine publisher - try multiple sources
          const publisher = publisherMatch?.[1] || 
                           (authorMatch?.[1] !== 'SYSTEM' ? authorMatch?.[1] : undefined) ||
                           'Unknown';

          packages.push({
            id,
            title: displayNameMatch?.[1] || titleMatch?.[1] || id,
            description: summaryMatch?.[1] || '',
            authors: [publisher || 'Unknown'],
            tags: [...categories, ...tags],
            latestVersion: versionMatch?.[1] || '1.0.0',
            downloadUrl: downloadUrl,
            publishedAt: publishedMatch?.[1] || updatedMatch?.[1] || new Date().toISOString(),
            iconUrl: iconUrl,
            previewImageUrl: previewImageUrl && previewImageUrl !== '' ? previewImageUrl : undefined,
            downloadCount: downloadCountMatch?.[1] ? parseInt(downloadCountMatch[1]) : 0,
            rating: ratingMatch?.[1] && ratingMatch[1] !== 'true' && ratingMatch[1] !== 'false' ? parseFloat(ratingMatch[1]) : undefined,
            ratingCount: ratingCountMatch?.[1] && ratingCountMatch[1] !== 'true' && ratingCountMatch[1] !== 'false' ? parseInt(ratingCountMatch[1]) : undefined,
            license: licenseMatch?.[1],
            moreInfoUrl: moreInfoMatch?.[1],
            targetPlatform: installationTargetMatch?.[1] || 'any',
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
      `ProGet VSIX feeds require manual package discovery. Please browse to ${this.getBaseFeedUrl()}/${packageId} to view available versions.`
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
      const downloadUrl = `${this.getBaseFeedUrl()}/download/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}`;
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
    extension.extensionPath = `${this.getBaseFeedUrl()}/download/${packageId}/${version}`;

    // Identity
    extension.identity.version = version;
    extension.identity.target = 'any';
    extension.identity.preRelease = false;
    extension.identity.preview = false;
    extension.identity.engine = '*';

    // Metadata
    extension.metadata.description = `Extension from ProGet feed: ${this.getBaseFeedUrl()}`;
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
    extension.links.support = this.getBaseFeedUrl();

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
      progetVersion.downloadUrl || `${this.getBaseFeedUrl()}/download/${progetPackage.id}/${progetVersion.version}`;

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
  previewImageUrl?: string;
  downloadCount?: number;
  totalDownloads?: number;
  latestVersion?: string;
  downloadUrl?: string;
  publishedAt?: string;
  rating?: number;
  ratingCount?: number;
  license?: string;
  moreInfoUrl?: string;
  targetPlatform?: string;
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
