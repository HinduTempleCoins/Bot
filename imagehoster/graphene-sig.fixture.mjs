// Captured 2026-10-18 from a headless Chromium running dsteem@0.11.1 (jsdelivr), the library the MELEK
// portal wallet signs with. Throwaway key: PrivateKey.fromSeed('melek-avatar-test-seed') — public seed, no account.
// sig = key.sign(sha256("ImageSigningChallenge" || data)).toString()
export const DSTEEM_FIXTURE = {
    pub: 'MELEK6MzwCV9mAZRsvDwKEAxvZChusPizvTBkeiEDSEo4UUf4DrSUHJ',
    sig: '1f67421f6de20b6a8100581296bcb8244b17e6a3f6baa38d50a73e520d551a122073be60e0650b5ac5a4f9aaf71939bf97ea499d7c16696e9a9e1b85b63e89cf6b',
    dataHex: '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fccfc0500f000485018084a98c210000000049454e44ae426082',
};
