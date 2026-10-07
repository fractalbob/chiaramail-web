import { createContext, useContext, useEffect, useState } from 'react';
import * as backend from '@backend';

const AuthCtx = createContext({ user: undefined });

// user: undefined while loading, null when signed out.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => backend.onUserChanged(setUser), []);
  return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
