export class PaperError extends Error {
    code;
    status;
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'PaperError';
    }
}
//# sourceMappingURL=errors.js.map