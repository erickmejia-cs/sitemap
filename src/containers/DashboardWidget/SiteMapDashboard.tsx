import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppSdk } from "../../common/hooks/useAppSdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExternalLink, faEdit, faChevronRight, faChevronDown, faChevronUp, faFolder, faFile } from "@fortawesome/pro-solid-svg-icons";
import "../index.css";
import "./StackDashboard.css";

const widgetStyles = `
  .layout-container,
  .ui-location,
  .ui-container {
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
`;

interface SiteMapEntry {
  contentType: string;
  contentTypeTitle: string;
  entryUid: string;
  entryTitle: string;
  url: string;
  locale: string;
}

interface TreeNode {
  name: string;
  path: string;
  entries: SiteMapEntry[];
  children: Map<string, TreeNode>;
  isLeaf: boolean;
}

const SiteMapDashboard = () => {
  const appSdk = useAppSdk();
  const [loading, setLoading] = useState(true);
  const [siteMapEntries, setSiteMapEntries] = useState<SiteMapEntry[]>([]);
  const [error, setError] = useState<string>("");
  const [environments, setEnvironments] = useState<any[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>("");
  const [locales, setLocales] = useState<any[]>([]);
  const [selectedLocale, setSelectedLocale] = useState<string>("");
  const [showEnvDropdown, setShowEnvDropdown] = useState(false);
  const [showLocaleDropdown, setShowLocaleDropdown] = useState(false);
  const envDropdownRef = useRef<HTMLDivElement>(null);
  const envButtonRef = useRef<HTMLButtonElement>(null);
  const localeDropdownRef = useRef<HTMLDivElement>(null);
  const localeButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<SiteMapEntry | null>(null);
  const [treeWidth, setTreeWidth] = useState<number>(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  const findUrlFields = useCallback((schema: any[]): string[] => {
    const urlFields: string[] = [];
    
    const traverseSchema = (fields: any[], path: string = ""): void => {
      if (!fields || !Array.isArray(fields)) return;
      
      for (const field of fields) {
        const fieldPath = path ? `${path}.${field.uid}` : field.uid;
        const fieldUidLower = field.uid?.toLowerCase() || '';
        const fieldTitleLower = field.title?.toLowerCase() || '';
        
        // Check if field is a URL field - multiple patterns
        const isUrlField = 
          field.data_type === 'text' && (
            fieldUidLower.includes('url') ||
            fieldUidLower === 'url' ||
            fieldTitleLower.includes('url') ||
            field.field_metadata?.format === 'url' ||
            field.field_metadata?.format === 'link' ||
            (field.data_type === 'link' && field.field_metadata?.ref_multiple_content_types === false)
          );
        
        if (isUrlField) {
          urlFields.push(fieldPath);
        }
        
        // Check nested structures
        if (field.schema && Array.isArray(field.schema)) {
          traverseSchema(field.schema, fieldPath);
        }
        if (field.fields && Array.isArray(field.fields)) {
          traverseSchema(field.fields, fieldPath);
        }
        if (field.data_type === 'group' && field.schema) {
          traverseSchema(field.schema, fieldPath);
        }
        if (field.data_type === 'blocks' && field.blocks) {
          for (const block of field.blocks) {
            if (block.schema && Array.isArray(block.schema)) {
              traverseSchema(block.schema, `${fieldPath}.${block.uid}`);
            }
          }
        }
      }
    };
    
    traverseSchema(schema);
    return urlFields;
  }, []);

  const extractUrlFromEntry = useCallback((entry: any, urlFields: string[]): string | null => {
    for (const fieldPath of urlFields) {
      const parts = fieldPath.split('.');
      let value = entry;
      
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = value[part];
        } else {
          value = null;
          break;
        }
      }
      
      // Handle string URLs
      if (value && typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
      
      // Handle link objects with href property
      if (value && typeof value === 'object' && value.href && typeof value.href === 'string' && value.href.trim() !== '') {
        return value.href.trim();
      }
    }
    
    return null;
  }, []);

  const loadSiteMap = useCallback(async () => {
    if (!appSdk) {
      setError("App SDK not initialized");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      
      const stack = appSdk.stack;
      
      if (!stack) {
        throw new Error("Stack not available");
      }

      // Get all content types
      const contentTypes = await stack.getContentTypes();
      const contentTypeArray = Array.isArray(contentTypes) ? contentTypes : (contentTypes?.content_types || contentTypes?.items || []);
      
      if (!contentTypeArray || contentTypeArray.length === 0) {
        setSiteMapEntries([]);
        setLoading(false);
        return;
      }

      const allEntries: SiteMapEntry[] = [];
      const localesToProcess = selectedLocale ? [selectedLocale] : (locales.length > 0 ? locales.map((l: any) => l.code || l) : ['en-us']);

      // Process each content type
      for (const contentType of contentTypeArray) {
        try {
          // Skip if content type doesn't have a uid
          if (!contentType || !contentType.uid) {
            continue;
          }

          // Get schema
          const schema = contentType.schema || contentType;
          const schemaFields = schema.schema || schema;
          
          if (!Array.isArray(schemaFields)) {
            continue;
          }

          // Find URL fields in schema
          const urlFields = findUrlFields(schemaFields);
          
          if (urlFields.length === 0) {
            continue; // Skip content types without URL fields
          }

          // Fetch entries for each locale
          for (const localeCode of localesToProcess) {
            let skip = 0;
            const limit = 100;
            let hasMore = true;

            while (hasMore) {
              try {
                const contentTypeInstance = stack.ContentType(contentType.uid);
                const EntryApi = (contentTypeInstance as any).Entry;
                
                if (!EntryApi) {
                  hasMore = false;
                  break;
                }
                
                const queryApi = EntryApi.Query();
                
                // Set locale for this query
                if (queryApi.locale) {
                  queryApi.locale(localeCode);
                } else if (queryApi.addParam) {
                  queryApi.addParam('locale', localeCode);
                }
                
                // Set environment for this query if selected
                if (selectedEnvironment) {
                  if (queryApi.environment) {
                    queryApi.environment(selectedEnvironment);
                  } else if (queryApi.addParam) {
                    queryApi.addParam('environment', selectedEnvironment);
                  }
                }
                
                queryApi.addParam('skip', skip.toString());
                queryApi.addParam('limit', limit.toString());
                
                const entriesResult = await queryApi.find();
                const entries = entriesResult?.items || entriesResult?.entries || [];

                if (entries && entries.length > 0) {
                  // Process each entry
                  for (const entry of entries) {
                    if (!entry || !entry.uid) {
                      continue;
                    }
                    
                    const url = extractUrlFromEntry(entry, urlFields);
                    
                    if (url) {
                      allEntries.push({
                        contentType: contentType.uid,
                        contentTypeTitle: contentType.title || contentType.uid,
                        entryUid: entry.uid,
                        entryTitle: entry.title || entry.uid || "Untitled",
                        url: url,
                        locale: localeCode,
                      });
                    }
                  }

                  if (entries.length < limit) {
                    hasMore = false;
                  } else {
                    skip += limit;
                  }
                } else {
                  hasMore = false;
                }
              } catch (entryError) {
                console.error(`Error fetching entries for content type ${contentType.uid} in locale ${localeCode}:`, entryError);
                hasMore = false;
              }
            }
          }
        } catch (err) {
          console.error(`Error processing content type ${contentType?.uid || 'unknown'}:`, err);
        }
      }

      // Sort by content type, then by title
      allEntries.sort((a, b) => {
        if (a.contentTypeTitle !== b.contentTypeTitle) {
          return a.contentTypeTitle.localeCompare(b.contentTypeTitle);
        }
        return a.entryTitle.localeCompare(b.entryTitle);
      });

      setSiteMapEntries(allEntries);
    } catch (err) {
      console.error('Error loading site map:', err);
      setError(err instanceof Error ? err.message : 'Failed to load site map');
    } finally {
      setLoading(false);
    }
  }, [appSdk, findUrlFields, extractUrlFromEntry, selectedLocale, locales, selectedEnvironment]);

  useEffect(() => {
    loadSiteMap();
  }, [loadSiteMap]);

  // Clear selected entry when environment or locale changes
  useEffect(() => {
    setSelectedEntry(null);
  }, [selectedEnvironment, selectedLocale]);

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeRef.current) return;
      
      const container = resizeRef.current;
      if (!container) return;
      
      const containerRect = container.getBoundingClientRect();
      // Calculate the difference from where we started dragging
      const deltaX = e.clientX - resizeStartX.current;
      const newWidth = resizeStartWidth.current + deltaX;
      const minWidth = 200;
      const maxWidth = containerRect.width - 200; // Leave minimum space for details panel
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setTreeWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing]);

  useEffect(() => {
    const loadEnvironments = async () => {
      if (!appSdk) {
        return;
      }

      try {
        const stack = appSdk.stack;
        
        if (stack && typeof stack.getEnvironments === 'function') {
          const result = await stack.getEnvironments();
          const envs = Array.isArray(result) ? result : (result?.environments || result?.items || []);
          if (envs.length > 0) {
            // Try to fetch full environment details if API key and auth token are available
            const apiKey = (appSdk as any).ids?.apiKey;
            const authtoken = (appSdk as any).connection?.authtoken;
            if (apiKey && authtoken) {
              try {
                const fullEnvs = await Promise.all(envs.map(async (env: any) => {
                  try {
                    const response = await fetch(`https://api.contentstack.io/v3/environments/${env.uid}`, {
                      headers: {
                        'api_key': apiKey,
                        'authtoken': authtoken,
                        'Content-Type': 'application/json',
                      },
                    });
                    if (response.ok) {
                      const data = await response.json();
                      return data.environment || env;
                    }
                  } catch (error) {
                    // Fallback to basic env data if API call fails
                  }
                  return env;
                }));
                
                const finalEnvs = fullEnvs.length > 0 ? fullEnvs : envs;
                const finalResult = Array.isArray(result) ? finalEnvs : { ...result, environments: finalEnvs };
                const finalEnvsArray = Array.isArray(finalResult) ? finalResult : (finalResult?.environments || finalResult?.items || []);
                
                if (finalEnvsArray && Array.isArray(finalEnvsArray) && finalEnvsArray.length > 0) {
                  setEnvironments(finalEnvsArray);
                  setSelectedEnvironment(finalEnvsArray[0].uid);
                  return;
                }
              } catch (error) {
                // Fall through to use basic environment data
              }
            }
          }
          
          const resultEnvs = Array.isArray(result) ? result : (result?.environments || result?.items || []);
          if (resultEnvs && Array.isArray(resultEnvs) && resultEnvs.length > 0) {
            setEnvironments(resultEnvs);
            setSelectedEnvironment(resultEnvs[0].uid);
          }
        }
      } catch (err) {
        console.error('Error loading environments:', err);
      }
    };

    loadEnvironments();
  }, [appSdk]);

  useEffect(() => {
    const loadLocales = async () => {
      if (!appSdk) {
        return;
      }

      try {
        const stack = appSdk.stack;
        const localesResult = await stack.getLocales();
        const localeArray = Array.isArray(localesResult) ? localesResult : (localesResult?.locales || localesResult?.items || []);
        if (localeArray.length > 0) {
          setLocales(localeArray);
          
          // Find the default locale - it's the one that has no fallback_locale or fallback_locale is null/undefined
          // or the one where fallback_locale equals its own code
          const defaultLocale = localeArray.find((locale: any) => {
            const code = locale.code || locale;
            const fallback = locale.fallback_locale || locale.fallbackLocale;
            return !fallback || fallback === code || fallback === null;
          });
          
          // If no default found by fallback logic, try to get it from stack info
          let defaultLocaleCode = defaultLocale?.code || defaultLocale;
          
          if (!defaultLocaleCode) {
            // Try to get default locale from stack
            try {
              const stackInfo = (stack as any).stack || (stack as any)._stack;
              if (stackInfo?.default_locale || stackInfo?.defaultLocale) {
                defaultLocaleCode = stackInfo.default_locale || stackInfo.defaultLocale;
              }
            } catch (e) {
              // Ignore errors
            }
          }
          
          // Fallback to first locale if no default found
          setSelectedLocale(defaultLocaleCode || localeArray[0].code || localeArray[0]);
        }
      } catch (err) {
        console.error('Error loading locales:', err);
      }
    };

    loadLocales();
  }, [appSdk]);

  const getBaseUrl = useCallback((): string => {
    try {
      if (document.referrer) {
        const referrerUrl = new URL(document.referrer);
        return referrerUrl.origin;
      } else {
        const currentHost = window.location.hostname;
        if (currentHost.includes('localhost') || currentHost.includes('127.0.0.1')) {
          const sdkHost = (appSdk as any)?.connection?.host || (appSdk as any)?.stack?._connection?.host;
          if (sdkHost) {
            return `https://${sdkHost}`;
          } else {
            return 'https://app.contentstack.com';
          }
        } else {
          if (currentHost.includes('contentstack.com')) {
            const parts = currentHost.split('.');
            if (parts.length >= 2 && parts[parts.length - 2] === 'contentstack') {
              const subdomain = parts.slice(0, -2).join('.');
              return `https://${subdomain}.contentstack.com`;
            } else {
              return 'https://app.contentstack.com';
            }
          } else {
            return 'https://app.contentstack.com';
          }
        }
      }
    } catch (e) {
      return 'https://app.contentstack.com';
    }
  }, [appSdk]);

  const openEntryEditor = useCallback((entry: SiteMapEntry) => {
    if (!appSdk) return;
    
    try {
      const apiKey = (appSdk as any).ids?.apiKey || (appSdk as any).stack?._data?.api_key;
      if (!apiKey) {
        console.warn("API key not available - cannot open entry editor");
        return;
      }
      
      let locale = entry.locale || (appSdk as any).stack?._data?.locale || 'en-us';
      // Contentstack URLs use just the language code (e.g., 'en' not 'en-us')
      if (locale.includes('-')) {
        locale = locale.split('-')[0];
      }
      
      const branch = (appSdk as any).stack?._data?.branch || (appSdk as any).branch || 'main';
      const baseUrl = getBaseUrl();
      
      const entryUrl = `${baseUrl}/#!/stack/${apiKey}/content-type/${entry.contentType}/${locale}/entry/${entry.entryUid}/edit?branch=${branch}`;
      window.open(entryUrl, '_blank');
    } catch (error) {
      console.error('Error opening entry editor:', error);
    }
  }, [appSdk, getBaseUrl]);

  const getFullUrl = useCallback((entry: SiteMapEntry): string => {
    if (!selectedEnvironment || !selectedLocale) {
      return entry.url;
    }

    const environment = environments.find((env: any) => env.uid === selectedEnvironment);
    if (!environment) {
      return entry.url;
    }

    // Try to get URL from environment
    const envUrls = environment.urls || environment.url || [];
    let baseUrlForTarget = '';
    
    if (Array.isArray(envUrls) && envUrls.length > 0) {
      // Get URL for the current locale if available
      const localeUrl = envUrls.find((urlItem: any) => {
        if (typeof urlItem === 'string') {
          return urlItem.includes(`/${selectedLocale}/`) || urlItem.includes(`/${selectedLocale}-`);
        }
        return urlItem.locale === selectedLocale || urlItem.locale === entry.locale;
      });
      if (localeUrl) {
        baseUrlForTarget = typeof localeUrl === 'string' ? localeUrl : (localeUrl.url || localeUrl.href || localeUrl.base_url || '');
      } else {
        baseUrlForTarget = typeof envUrls[0] === 'string' ? envUrls[0] : (envUrls[0].url || envUrls[0].href || envUrls[0].base_url || '');
      }
    } else if (typeof environment.url === 'string') {
      baseUrlForTarget = environment.url;
    } else if (typeof environment.base_url === 'string') {
      baseUrlForTarget = environment.base_url;
    }

    // Construct full target URL
    let targetUrl = entry.url;
    if (!targetUrl.startsWith('http')) {
      if (baseUrlForTarget) {
        const base = baseUrlForTarget.replace(/\/$/, '');
        const path = targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`;
        targetUrl = `${base}${path}`;
      }
    }

    return targetUrl;
  }, [selectedEnvironment, selectedLocale, environments]);

  const openVisualBuilder = useCallback((entry: SiteMapEntry) => {
    if (!appSdk) return;
    
    try {
      const apiKey = (appSdk as any).ids?.apiKey || (appSdk as any).stack?._data?.api_key;
      if (!apiKey) {
        console.warn("API key not available - cannot open visual builder");
        return;
      }
      
      let locale = entry.locale || (appSdk as any).stack?._data?.locale || 'en-us';
      // Extract just the language code (e.g., 'en' from 'en-us')
      if (locale.includes('-')) {
        locale = locale.split('-')[0];
      }
      
      const branch = (appSdk as any).stack?._data?.branch || (appSdk as any).branch || 'main';
      const baseUrl = getBaseUrl();
      
      // Get environment UID - use selected environment
      const environmentUid = selectedEnvironment || (environments.length > 0 ? environments[0].uid : '');
      
      if (!environmentUid) {
        console.error('No environment found');
        return;
      }
      
      // Construct target URL
      // Try to get base URL from environment URLs
      let baseUrlForTarget = '';
      const environment = environments.find((env: any) => env.uid === environmentUid);
      if (environment) {
        // Try to get URL from environment
        const envUrls = environment.urls || environment.url || [];
        if (Array.isArray(envUrls) && envUrls.length > 0) {
          // Get URL for the current locale if available
          const localeUrl = envUrls.find((urlItem: any) => {
            if (typeof urlItem === 'string') {
              return urlItem.includes(`/${locale}/`) || urlItem.includes(`/${locale}-`);
            }
            return urlItem.locale === locale || urlItem.locale === entry.locale;
          });
          if (localeUrl) {
            baseUrlForTarget = typeof localeUrl === 'string' ? localeUrl : (localeUrl.url || localeUrl.href || localeUrl.base_url || '');
          } else {
            baseUrlForTarget = typeof envUrls[0] === 'string' ? envUrls[0] : (envUrls[0].url || envUrls[0].href || envUrls[0].base_url || '');
          }
        } else if (typeof environment.url === 'string') {
          baseUrlForTarget = environment.url;
        } else if (typeof environment.base_url === 'string') {
          baseUrlForTarget = environment.base_url;
        }
      }
      
      // Construct full target URL
      let targetUrl = entry.url;
      if (!targetUrl.startsWith('http')) {
        // If we have a base URL from environment, use it
        if (baseUrlForTarget) {
          // Remove trailing slash from base URL and ensure entry URL starts with /
          const base = baseUrlForTarget.replace(/\/$/, '');
          const path = targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`;
          targetUrl = `${base}${path}`;
        } else {
          // Fallback: use entry URL as-is (relative)
          targetUrl = entry.url;
        }
      }
      
      // URL encode the target URL
      const encodedTargetUrl = encodeURIComponent(targetUrl);
      
      const visualBuilderUrl = `${baseUrl}/#!/stack/${apiKey}/visual-builder?branch=${branch}&locale=${locale}&environment=${environmentUid}&target-url=${encodedTargetUrl}&entry_uid=${entry.entryUid}&content_type_uid=${entry.contentType}`;
      window.open(visualBuilderUrl, '_blank');
    } catch (error) {
      console.error('Error opening Visual Builder:', error);
    }
  }, [appSdk, getBaseUrl, environments, selectedEnvironment]);

  // Build tree structure from URL paths
  const urlTree = useMemo(() => {
    const root: TreeNode = {
      name: '/',
      path: '/',
      entries: [],
      children: new Map(),
      isLeaf: false,
    };

    siteMapEntries.forEach(entry => {
      // Parse URL path
      let urlPath = entry.url;
      
      // Remove protocol and domain if present
      try {
        const urlObj = new URL(urlPath);
        urlPath = urlObj.pathname;
      } catch {
        // Already a path, use as-is
        if (!urlPath.startsWith('/')) {
          urlPath = `/${urlPath}`;
        }
      }

      // Handle root path (/)
      if (urlPath === '/' || urlPath === '') {
        root.entries.push(entry);
        return;
      }

      // Split path into segments
      const segments = urlPath.split('/').filter(segment => segment.length > 0);
      
      // If no segments after filtering, it's the root
      if (segments.length === 0) {
        root.entries.push(entry);
        return;
      }
      
      // Build tree structure
      let currentNode = root;
      let currentPath = '/';
      
      segments.forEach((segment, index) => {
        const isLastSegment = index === segments.length - 1;
        currentPath = currentPath === '/' ? `/${segment}` : `${currentPath}/${segment}`;
        
        if (!currentNode.children.has(segment)) {
          currentNode.children.set(segment, {
            name: segment,
            path: currentPath,
            entries: [],
            children: new Map(),
            isLeaf: isLastSegment,
          });
        }
        
        currentNode = currentNode.children.get(segment)!;
        
        if (isLastSegment) {
          currentNode.entries.push(entry);
          currentNode.isLeaf = true;
        }
      });
    });

    return root;
  }, [siteMapEntries]);

  // Expand root by default
  useEffect(() => {
    if (siteMapEntries.length > 0 && expandedPaths.size === 0) {
      const paths = new Set<string>();
      paths.add('/'); // Only expand the root
      setExpandedPaths(paths);
    }
  }, [siteMapEntries.length, expandedPaths.size]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  // Render tree node recursively
  const renderTreeNode = useCallback((node: TreeNode, level: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children.size > 0;
    const hasEntries = node.entries.length > 0;
    const isRoot = node.path === '/';

    return (
      <div key={node.path} className="leading-none">
        {/* Folder/Node */}
        {(hasChildren || hasEntries) && (
          <div
            className={`flex items-center py-0.5 rounded select-none ${hasChildren ? 'cursor-pointer hover:bg-gray-100' : 'cursor-default'}`}
            style={{ paddingLeft: `${level * 1.5}rem` }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (hasChildren) {
                togglePath(node.path);
              }
            }}
          >
            <div className={`flex items-center justify-center w-5 shrink-0 ${hasChildren ? 'h-5' : 'h-4'}`}>
              {hasChildren && (
                <FontAwesomeIcon
                  icon={isExpanded ? faChevronDown : faChevronRight}
                  className="w-3 h-3 text-gray-500 block"
                />
              )}
            </div>
            <div className={`flex items-center justify-center mr-2 shrink-0 ${hasChildren ? 'w-5 h-5' : 'w-4 h-4'}`}>
              <FontAwesomeIcon
                icon={hasChildren ? faFolder : faFile}
                className={`block ${hasChildren ? 'text-blue-500 text-xl' : 'text-gray-400 text-base'}`}
              />
            </div>
            <span className={`flex-1 flex items-center text-sm leading-5 h-5 ${hasChildren ? 'font-semibold' : 'font-medium'}`}>
              {isRoot ? '/' : node.name}
            </span>
            {hasEntries && !isRoot && (
              <span className="text-gray-500 text-xs mr-2 shrink-0 leading-5 h-5 flex items-center">
                ({node.entries.length})
              </span>
            )}
          </div>
        )}

        {/* Entries for this node - only show when expanded or if no children */}
        {hasEntries && (isExpanded || !hasChildren) && (
          <div className="leading-none">
            {node.entries.map((entry, index) => (
              <div
                key={`${entry.contentType}-${entry.entryUid}-${index}`}
                className={`flex items-center py-0.5 rounded cursor-pointer ${selectedEntry?.entryUid === entry.entryUid && selectedEntry?.contentType === entry.contentType ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'}`}
                style={{ paddingLeft: `${(level + 1) * 1.5}rem` }}
                onClick={() => setSelectedEntry(entry)}
              >
                <div className="flex items-center justify-center w-5 shrink-0 h-5" />
                <div className="flex items-center justify-center mr-2 shrink-0 w-5 h-5">
                  <FontAwesomeIcon
                    icon={faFile}
                    className="text-gray-400 block text-xl"
                  />
                </div>
                <div className="flex items-center flex-1 min-w-0">
                  <span className="font-medium whitespace-nowrap text-sm">{entry.entryTitle}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="leading-none" onMouseDown={(e) => e.stopPropagation()}>
            {Array.from(node.children.values())
              .sort((a, b) => {
                // Sort: folders first, then files, then alphabetically
                if (a.children.size > 0 && b.children.size === 0) return -1;
                if (a.children.size === 0 && b.children.size > 0) return 1;
                return a.name.localeCompare(b.name);
              })
              .map(child => {
                // Collapse intermediate nodes that only have entries (no other children)
                // This happens when a path segment only contains entries, not subfolders
                if (child.children.size === 0 && child.entries.length > 0) {
                  // Render entries directly at this level instead of creating a folder node
                  return (
                    <div key={child.path} className="leading-none">
                      {child.entries.map((entry, index) => (
                        <div
                          key={`${entry.contentType}-${entry.entryUid}-${index}`}
                          className={`flex items-center py-0.5 rounded cursor-pointer ${selectedEntry?.entryUid === entry.entryUid && selectedEntry?.contentType === entry.contentType ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'}`}
                          style={{ paddingLeft: `${(level + 1) * 1.5}rem` }}
                          onClick={() => setSelectedEntry(entry)}
                        >
                          <div className="flex items-center justify-center w-5 shrink-0 h-5" />
                          <div className="flex items-center justify-center mr-2 shrink-0 w-5 h-5">
                            <FontAwesomeIcon
                              icon={faFile}
                              className="text-gray-400 block text-xl"
                            />
                          </div>
                          <div className="flex items-center flex-1 min-w-0">
                            <span className="font-medium whitespace-nowrap text-sm">{entry.entryTitle}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }
                // Normal rendering for nodes with children or mixed content
                return renderTreeNode(child, level + 1);
              })}
          </div>
        )}
      </div>
    );
  }, [expandedPaths, togglePath, openEntryEditor, openVisualBuilder, selectedEntry]);

  // Position dropdowns
  useEffect(() => {
    if (showEnvDropdown && envDropdownRef.current && envButtonRef.current) {
      const buttonRect = envButtonRef.current.getBoundingClientRect();
      const dropdown = envDropdownRef.current;
      
      dropdown.style.top = `${buttonRect.bottom + 4}px`;
      dropdown.style.left = `${buttonRect.left}px`;
      dropdown.style.width = `${buttonRect.width}px`;
      
      const spaceBelow = window.innerHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;
      if (spaceBelow < 300 && spaceAbove > spaceBelow) {
        dropdown.style.top = "auto";
        dropdown.style.bottom = `${window.innerHeight - buttonRect.top + 4}px`;
      }
    }
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-env-dropdown]')) {
        setShowEnvDropdown(false);
      }
    };

    if (showEnvDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showEnvDropdown]);

  useEffect(() => {
    if (showLocaleDropdown && localeDropdownRef.current && localeButtonRef.current) {
      const buttonRect = localeButtonRef.current.getBoundingClientRect();
      const dropdown = localeDropdownRef.current;
      
      dropdown.style.top = `${buttonRect.bottom + 4}px`;
      dropdown.style.left = `${buttonRect.left}px`;
      dropdown.style.width = `${buttonRect.width}px`;
      
      const spaceBelow = window.innerHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;
      if (spaceBelow < 300 && spaceAbove > spaceBelow) {
        dropdown.style.top = "auto";
        dropdown.style.bottom = `${window.innerHeight - buttonRect.top + 4}px`;
      }
    }
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-locale-dropdown]')) {
        setShowLocaleDropdown(false);
      }
    };

    if (showLocaleDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showLocaleDropdown]);

  return (
    <>
      <style>{widgetStyles}</style>
      <div className="layout-container flex basis-full min-w-0">
        <div className="ui-location flex flex-col overflow-hidden w-full! h-full">
          <div className="flex flex-col flex-1 overflow-hidden px-[20px] w-full h-full">
            <div className="flex gap-3 items-end shrink-0 mb-5">
              <div className={`flex-1 min-w-0 relative ${showEnvDropdown ? 'z-1000' : 'z-auto'}`} data-env-dropdown>
                <div className="label-container">
                  <p className="label">Select Environment</p>
                </div>
                <div className="relative w-full" data-env-dropdown>
                  <button
                    ref={envButtonRef}
                    type="button"
                    onClick={() => setShowEnvDropdown(!showEnvDropdown)}
                    disabled={loading}
                    className="w-full px-2 py-2 border border-gray-300 rounded bg-white cursor-pointer text-left flex justify-between items-center box-border disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>
                      {environments.find((e) => e.uid === selectedEnvironment)?.name || "Select Environment"}
                    </span>
                    <FontAwesomeIcon 
                      icon={showEnvDropdown ? faChevronUp : faChevronDown} 
                      className="text-xs text-gray-600"
                    />
                  </button>

                  {showEnvDropdown && (
                    <div
                      ref={envDropdownRef}
                      className="fixed bg-white border border-gray-300 rounded shadow-lg max-h-[300px] overflow-y-auto w-full z-10000"
                    >
                      {environments.map((env) => (
                        <button
                          key={env.uid}
                          type="button"
                          onClick={() => {
                            setSelectedEnvironment(env.uid);
                            setShowEnvDropdown(false);
                          }}
                          className={`w-full px-4 py-3 border-0 cursor-pointer text-left text-sm min-h-[40px] ${
                            selectedEnvironment === env.uid ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          {env.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={`flex-1 min-w-0 relative ${showLocaleDropdown ? 'z-1000' : 'z-auto'}`} data-locale-dropdown>
                <div className="label-container">
                  <p className="label">Select Locale</p>
                </div>
                <div className="relative w-full" data-locale-dropdown>
                  <button
                    ref={localeButtonRef}
                    type="button"
                    onClick={() => setShowLocaleDropdown(!showLocaleDropdown)}
                    disabled={loading}
                    className="w-full px-2 py-2 border border-gray-300 rounded bg-white cursor-pointer text-left flex justify-between items-center box-border disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>
                      {locales.find((l) => (l.code || l) === selectedLocale)?.code || selectedLocale || "Select Locale"}
                    </span>
                    <FontAwesomeIcon 
                      icon={showLocaleDropdown ? faChevronUp : faChevronDown} 
                      className="text-xs text-gray-600"
                    />
                  </button>

                  {showLocaleDropdown && (
                    <div
                      ref={localeDropdownRef}
                      className="fixed bg-white border border-gray-300 rounded shadow-lg max-h-[300px] overflow-y-auto w-full z-10000"
                    >
                      {locales.map((locale) => {
                        const localeCode = locale.code || locale;
                        return (
                          <button
                            key={localeCode}
                            type="button"
                            onClick={() => {
                              setSelectedLocale(localeCode);
                              setShowLocaleDropdown(false);
                            }}
                            className={`w-full px-4 py-3 border-0 cursor-pointer text-left text-sm min-h-[40px] ${
                              selectedLocale === localeCode ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
                            }`}
                          >
                            {localeCode}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {loading && (
              <div className="text-center py-8">
                <p>Loading site map...</p>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-md mb-4">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            {!loading && !error && (
              <>
                {siteMapEntries.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No entries with URL fields found.</p>
                  </div>
                ) : (
                  <div ref={resizeRef} className="flex-1 flex gap-0 overflow-hidden min-h-0">
                    {/* Tree Panel */}
                    <div data-tree-panel className="overflow-auto border border-gray-200 rounded-md p-2 min-h-0" style={{ 
                      width: treeWidth > 0 ? `${treeWidth}px` : 'auto',
                      flex: treeWidth > 0 ? '0 0 auto' : '1 1 auto',
                      minWidth: treeWidth > 0 ? `${treeWidth}px` : '200px'
                    }}>
                      <div className="text-sm">
                        {renderTreeNode(urlTree)}
                      </div>
                    </div>
                    
                    {/* Resize Handle */}
                    <div className="flex items-center justify-center shrink-0 px-1" data-resize-handle>
                      <div
                        onMouseDown={(e) => {
                          if (resizeRef.current) {
                            const container = resizeRef.current;
                            const containerRect = container.getBoundingClientRect();
                            const treePanel = container.querySelector('[data-tree-panel]');
                            const treeRect = treePanel?.getBoundingClientRect();
                            resizeStartX.current = e.clientX;
                            resizeStartWidth.current = treeRect ? treeRect.width : (treeWidth > 0 ? treeWidth : containerRect.width / 2);
                            setIsResizing(true);
                          }
                        }}
                        className={`w-1 h-16 cursor-col-resize rounded-full ${isResizing ? 'bg-blue-500' : 'bg-gray-300'} ${isResizing ? '' : 'transition-colors duration-200'} hover:bg-gray-400`}
                      />
                    </div>
                    
                    {/* Details Panel */}
                    {selectedEntry && (
                      <div className="flex-1 min-w-[200px] border border-gray-200 rounded-md p-5 overflow-y-auto bg-white">
                        <h3 className="text-lg font-semibold mb-4 text-gray-900">
                          {selectedEntry.entryTitle}
                        </h3>
                        
                        <div className="mb-4">
                          <div className="mb-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Content Type</div>
                            <div className="text-sm text-gray-900">{selectedEntry.contentTypeTitle}</div>
                          </div>
                          
                          <div className="mb-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">URL</div>
                            <div className="text-sm text-gray-900 break-all">
                              <a
                                href={getFullUrl(selectedEntry)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 no-underline hover:underline"
                              >
                                {getFullUrl(selectedEntry)}
                              </a>
                            </div>
                          </div>
                          
                          <div className="mb-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Entry UID</div>
                            <div className="text-sm text-gray-900 font-mono">{selectedEntry.entryUid}</div>
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-3 mt-6 pt-6 border-t border-gray-200">
                          <button
                            onClick={() => openEntryEditor(selectedEntry)}
                            className="w-full px-4 py-2 bg-blue-500 text-white border-0 rounded-md cursor-pointer text-sm font-medium flex items-center justify-center gap-2 hover:bg-blue-600 transition"
                          >
                            <FontAwesomeIcon icon={faEdit} />
                            Edit Entry
                          </button>
                          <button
                            onClick={() => openVisualBuilder(selectedEntry)}
                            className="w-full px-4 py-2 bg-green-500 text-white border-0 rounded-md cursor-pointer text-sm font-medium flex items-center justify-center gap-2 hover:bg-green-600 transition"
                          >
                            <FontAwesomeIcon icon={faExternalLink} />
                            Open in Visual Editor
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {!selectedEntry && (
                      <div className="flex-1 min-w-[200px] border border-gray-200 rounded-md p-5 flex items-center justify-center bg-gray-50 text-gray-500">
                        <p className="text-sm text-center">Select an entry to view details</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default SiteMapDashboard;

