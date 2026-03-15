export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const handleError = (err: Error, res: { status: (code: number) => { json: (body: any) => void } }) => {
  console.error(err);
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
};