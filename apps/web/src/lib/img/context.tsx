import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ImageManifest } from './types';

interface ImgManifestContextProps {
  manifest: ImageManifest;
  isLoaded: boolean;
}

const ImgManifestContext = createContext<ImgManifestContextProps>({
  manifest: {},
  isLoaded: false,
});

export function ImgManifestProvider({ children }: { children: ReactNode }) {
  const [manifest, setManifest] = useState<ImageManifest>({});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function fetchManifest() {
      try {
        const response = await fetch('/img-manifest');
        if (response.ok) {
          const data = await response.json();
          setManifest(data);
        }
      } catch (error) {
        console.error('Failed to fetch image manifest:', error);
      } finally {
        setIsLoaded(true);
      }
    }
    fetchManifest();
  }, []);

  return <ImgManifestContext.Provider value={{ manifest, isLoaded }}>{children}</ImgManifestContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useImgManifest() {
  return useContext(ImgManifestContext);
}
