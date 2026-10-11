'use strict';

export default function parseProtocol(url: string): string {
  const match = /^([-+\w]{1,25}):(?:\/\/)?/.exec(url);
  return (match && match[1]) || '';
}
