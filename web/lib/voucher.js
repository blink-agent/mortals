// Mint voucher signing.
//
// Mortals.mint() recovers an ECDSA signature over
//   keccak256(abi.encode(minter, quantity, nonce, block.chainid, address(this)))
// wrapped in the EIP-191 personal-sign prefix (MessageHashUtils.toEthSignedMessageHash).
// ethers' signer.signMessage(getBytes(digest)) produces exactly that.
//
// Kept dependency-light and env-free so the test script can drive it directly.

import { ethers } from 'ethers';

export function mintDigest({ minter, quantity, nonce, chainId, mortalsAddr }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'uint256', 'address'],
    [minter, BigInt(quantity), nonce, BigInt(chainId), mortalsAddr],
  );
  return ethers.keccak256(encoded);
}

export function randomNonce() {
  return ethers.hexlify(ethers.randomBytes(32));
}

/**
 * @returns {Promise<{nonce: string, signature: string, digest: string, signer: string}>}
 */
export async function signVoucher({ signerPk, minter, quantity, chainId, mortalsAddr, nonce }) {
  const wallet = new ethers.Wallet(signerPk);
  const n = nonce || randomNonce();
  const digest = mintDigest({ minter, quantity, nonce: n, chainId, mortalsAddr });
  const signature = await wallet.signMessage(ethers.getBytes(digest));
  return { nonce: n, signature, digest, signer: wallet.address };
}

/** Address that signed a voucher — used by the test script to assert round-trip. */
export function recoverVoucherSigner({ minter, quantity, nonce, chainId, mortalsAddr, signature }) {
  const digest = mintDigest({ minter, quantity, nonce, chainId, mortalsAddr });
  return ethers.verifyMessage(ethers.getBytes(digest), signature);
}
