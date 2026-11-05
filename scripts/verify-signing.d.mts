export interface SigningResult {
  status: 'signed' | 'unsigned' | 'invalid';
  notarized: boolean;
  detail: string;
}
export function interpretAuthenticode(status: string): { status: SigningResult['status']; detail: string };
export function interpretCodesignFailure(verifyOutput: string, displayOutput?: string): { status: SigningResult['status']; detail: string };
export function verifySigning(platform: 'win' | 'mac' | 'linux', file: string): SigningResult;
export function checkExpectation(result: SigningResult, options: { expect?: string; expectNotarized?: boolean }): string[];
