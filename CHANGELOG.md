# agentdist

## 0.1.1

### Patch Changes

- [#4](https://github.com/krishchow/agentdist/pull/4) [`d528cef`](https://github.com/krishchow/agentdist/commit/d528ceffd27c5711ddf67cf3665977d4511146f9) Thanks [@krishchow](https://github.com/krishchow)! - Types now resolve for consumers using `"module": "node16"` or `"nodenext"`. Before, every import from `agentdist` was `any` there, and `skipLibCheck` hid the error.
