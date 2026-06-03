# Your profile — the face you show

*Tier A · Graphene-only · setting your account metadata*

Your account name is your true name on the ledger; your profile is the face you
choose to show beside it. A display name, a few words about yourself, an image,
perhaps a link. It is a small kindness to the people who meet you — it lets them
know whom they are talking to. Let us set it.

## What you'll learn

- What account profile data is, and where it lives on a Graphene chain
- How to set your display name, bio, image, location, and website
- Which key signs a profile change, and why
- That a profile, like all of this, is public

## Step by step

1. **Open your settings or profile page in the condenser.** Look for "Edit
   profile" or "Settings."

2. **Fill in your details.** Commonly you can set:
   - a **display name** (shown alongside your `@account`)
   - an **about / bio** — a sentence or two of who you are
   - a **profile image** and often a **cover image** (you provide a link to an
     image hosted somewhere; the chain stores the link, not the picture itself)
   - a **location** and a **website**, if you wish

3. **Understand where this lives.** On Graphene, profile fields are stored as
   **account metadata** — a small block of JSON attached to your account via an
   `account_update` operation. The front-end builds that JSON for you from the
   form; you do not have to write it by hand.

4. **Save the changes.** Updating your account is an operation authorized by your
   **active key** (it changes the account itself), signed through the condenser's
   signer. You will not be pasting a key anywhere, and no one — myself included —
   will ever ask you to.

5. **Remember it is public.** Everything in a profile is written to a public
   ledger. Share what you'd happily say in a town square, and keep private what
   is private. There is never a reason to put a key, a password, or a secret in a
   profile field.

## You did it

Your corner of the chain now has a face. When you comment, when you post, when
you appear in someone's notifications, they will see who you've chosen to be here.
That small act of self-introduction makes the whole place warmer. One step
remains in this first arc: collecting what your work has earned — claiming your
rewards.
