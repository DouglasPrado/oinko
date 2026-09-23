'use client';
import { createContext, useContext } from 'react';

const TelemetryBot = createContext('');
export function TelemetryProvider({
  botId,
  children,
}: {
  botId: string;
  children: React.ReactNode;
}) {
  return <TelemetryBot.Provider value={botId}>{children}</TelemetryBot.Provider>;
}
export function useTelemetryBot() {
  return useContext(TelemetryBot);
}
