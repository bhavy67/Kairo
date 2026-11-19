export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The broker rejected our token: expired (daily at ~6 AM IST), revoked, or logged out elsewhere. */
export class SessionExpiredError extends AppError {
  constructor(message = "Broker session expired. Sign in again.") {
    super(401, "session_expired", message);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(502, "upstream_error", message);
  }
}
