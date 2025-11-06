export interface WhatsAppSession {
  clientId: string;
  sock: any;
  qr: string | null;
  state: 'Initializing' | 'Connected' | 'Disconnected' | 'Failure';
  phoneNumber?: string;
  profileName?: string;
  profilePicUrl?: string;
}

export interface CreateSessionRequest {
  clientId: string;
}

export interface SendMessageRequest {
  clientId: string;
  to: string;
  message: string;
}
