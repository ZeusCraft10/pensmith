// Types for tests/helpers/local-servers/dial-recorder.mjs (a plain ESM preload).

export type DialEvent =
  | {
      kind: 'connect';
      tls: boolean;
      host: string | undefined;
      /** undici passes the port as a string. */
      port: number | string | undefined;
      servername?: string;
      /** The addresses the dial's own (pinned) lookup answers with, when it has one. */
      addresses?: string[];
    }
  | { kind: 'dns'; host: string }
  | { kind: 'read'; path: string };

export interface DialRecorder {
  readonly events: DialEvent[];
  /** TCP / TLS connect attempts only. */
  dials(): Array<Extract<DialEvent, { kind: 'connect' }>>;
  restore(): void;
}

export interface DialRecorderOptions {
  /** Default true: every recorded dial then fails with ECONNREFUSED. */
  refuseConnects?: boolean;
  /** Default false: a dial to a loopback IP literal (127.0.0.0/8, ::1) is recorded but allowed. */
  allowLoopback?: boolean;
  onEvent?: (e: DialEvent) => void;
}

export function installDialRecorder(opts?: DialRecorderOptions): DialRecorder;

/** Read a dial log written in preload mode (PENSMITH_DIAL_LOG). */
export function readDialLog(file: string): DialEvent[];
