'use client'

import React from 'react'
import { Shield, Lock, Eye, Database, Bell, Users, Globe, Scale, MessageSquare, Flag } from 'lucide-react'

export function UgcPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <MessageSquare className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Community Content Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: August 29, 2026</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><MessageSquare className="size-4 text-primary" /> 1. What This Policy Covers</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER lets registered users share signals, posts, comments, direct messages, group content, and screenshots (collectively, &ldquo;user content&rdquo;). This policy explains what is allowed, how you can report content that violates it, and how we handle reports and appeals. User content is visibility-controlled by your privacy settings (for example, profile visibility and sharing preferences) and is subject to our Terms of Service, Privacy Policy, and the Google Play Developer Program Policies.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">2. Allowed Content</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You may share your own trading signals, educational analysis, and community discussion, provided the content is accurate to the best of your knowledge, clearly marked as an opinion or signal (not financial advice), and does not misrepresent your performance or rank. Sharing content you were paid or incentivized to promote must be disclosed.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Flag className="size-4 text-primary" /> 3. Prohibited Content</h2>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive leading-relaxed">
          <p className="font-medium mb-2">The following content is prohibited and may be removed without notice:</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Scams, get-rich-quick schemes, or services promising guaranteed returns, including unsolicited private messages offering &ldquo;signals&rdquo; or &ldquo;bots&rdquo; for a fee.</li>
            <li>Illegal activity, fraud, money-laundering, or facilitation of gambling on unregulated platforms where prohibited by law.</li>
            <li>Harassment, bullying, threats, doxxing, or sharing others&apos; personal data without consent.</li>
            <li>Hate speech or content that promotes violence, discrimination, or any group or individual in a targeting manner.</li>
            <li>Sexually explicit or obscene material, nude or sexualized imagery.</li>
            <li>Spam, malicious links, malware, or content designed to trick or mislead other users.</li>
            <li>Impersonation of TOPTIER staff, licensed brokers, or other users.</li>
            <li>Misrepresentation of trading performance, fabricated results, or fake copy-trading records.</li>
            <li>Any content that violates applicable law or the Google Play Developer Program Policies.</li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">4. In-App Reporting</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Every post, comment, message, group, and trader profile includes a report option. Tap the flag/more menu on the content, choose a reason, and we receive the report together with the reported content and your account details (kept confidential). You can also report content or users through the Support section or by emailing support@toptier.app. You do not need to be involved in the conversation to report content.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Flag className="size-4 text-primary" /> 5. How We Handle Reports</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We review reported content and take action in line with this policy, our Terms of Service, and applicable law. Actions can include removal of content, suspension or termination of accounts, and, where serious or legally required, referral to law enforcement. We aim to review reports within 24&ndash;72 hours. Users whose content is removed are notified with the reason where feasible.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">6. Appeals</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you believe a moderation decision was wrong — content you posted was removed in error, or your account was suspended unfairly — you may appeal within 30 days of the decision. Send your appeal to support@toptier.app or via the Support section with the subject &ldquo;Appeal&rdquo; and include your account email, the content or account action in question, and why you believe the decision was incorrect. We will review the appeal with a person who was not involved in the original decision and respond within 30 days. Decisions on appeal are final.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Scale className="size-4 text-primary" /> 7. Our Moderation Commitment</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We review user content for compliance with this policy, including through proactive monitoring of signals and community features and handling of user reports. Automated review may be used to detect spam and abuse; any automated decision that materially affects your account can be reviewed manually on request. Content that violates the Google Play Developer Program Policies or applicable law may be reported to Google or the relevant authorities.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">8. Your Responsibilities</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You are solely responsible for the user content you share. TOPTIER does not endorse or verify community content, and sharing is not a recommendation to trade. Trading content shared by others is educational and informational only. Repeated violations may result in permanent account suspension per our Terms of Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">9. Contact</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          For questions about this policy, reporting, or appeals, contact us at support@toptier.app or through the Support section of the app.
        </p>
      </section>
    </div>
  )
}

export function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: June 16, 2026</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Eye className="size-4 text-primary" /> 1. Information We Collect</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER collects information that you provide directly to us, information collected automatically when you use our services, and information from third-party sources. This includes your account details (name, email address, phone number), trading preferences and settings, watchlist data and alert configurations, screenshots and images you upload for analysis, and device and usage analytics. We collect this information to provide and improve our trading signal services, personalize your experience, process transactions, communicate with you, and ensure the security of our platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Database className="size-4 text-primary" /> 2. How We Use Your Information</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We use the information we collect to operate, maintain, and improve TOPTIER&apos;s services. Specifically, we use your data to generate personalized trading signals based on your preferences and risk profile, analyze uploaded screenshots using AI models to identify chart patterns and trading opportunities, send you notifications about price alerts, signal updates, and market events, provide community features including signal sharing and social trading, process subscription payments and manage your account, monitor and analyze usage patterns to improve our AI models and user experience, and detect and prevent fraud, abuse, and security issues. We do not sell your personal information to third parties under any circumstances.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Lock className="size-4 text-primary" /> 3. Data Security</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We implement industry-standard security measures to protect your personal information, including encryption of data in transit using TLS 1.3, encryption of sensitive data at rest using AES-256, regular security audits and penetration testing, access controls limiting employee access to personal data, and monitoring systems to detect unauthorized access or security breaches. While we strive to protect your information, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security, but we continuously invest in improving our security infrastructure.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="size-4 text-primary" /> 4. Third-Party Sharing</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may share your information with service providers who assist in operating our platform (cloud hosting, payment processing, analytics), law enforcement when required by law or to protect our rights, and business partners with your explicit consent. When you use community features, the signals you choose to share will be visible to other users according to your privacy settings. We are not responsible for the privacy practices of third-party services, and we encourage you to review their privacy policies.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Globe className="size-4 text-primary" /> 5. International Data Transfers</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER operates globally and your information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws. When we transfer data internationally, we ensure appropriate safeguards are in place, including standard contractual clauses approved by relevant authorities, compliance with applicable data protection frameworks such as GDPR, and ensuring our partners maintain equivalent levels of data protection.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Bell className="size-4 text-primary" /> 6. Your Rights</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Depending on your jurisdiction, you may have the right to access and receive a copy of your personal data, rectify inaccurate or incomplete personal data, delete your personal data (subject to legal requirements), restrict or object to the processing of your data, data portability (receive your data in a structured format), and withdraw consent at any time where processing is based on consent. To exercise any of these rights, please contact us through the app settings or at privacy@toptier.app. We will respond to your request within 30 days.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-5">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Database className="size-4 text-primary" /> Request Deletion of Your Data</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          To request the permanent deletion of your account and personal data, you can:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
          <li>
            Submit a request online: <a href="/account-deletion" className="font-medium text-primary underline underline-offset-4">Delete My Account &amp; Data</a>
          </li>
          <li>
            Or, if you are logged in: <span className="font-medium">Settings → Account → Delete Account</span>
          </li>
          <li>
            Or email us at <span className="font-medium">privacy@toptier.app</span> with the subject &ldquo;Delete Account&rdquo;
          </li>
        </ul>
        <a
          href="/account-deletion"
          className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Database className="size-4" /> Delete My Account &amp; Data
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">7. Data Retention</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We retain your personal information for as long as your account is active or as needed to provide services, comply with legal obligations, resolve disputes, and enforce our agreements. When you delete your account, we will delete your personal data within 30 days, except where we are required to retain it by law (such as financial transaction records which may be retained for up to 7 years). Anonymous, aggregated data may be retained indefinitely for analytics purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">8. Children&apos;s Privacy</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER is not intended for use by individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a person under 18, we will take steps to delete that information promptly. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">9. Changes to This Policy</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may update this Privacy Policy from time to time. If we make material changes, we will notify you through the app, by email, or by other means prior to the change becoming effective. Your continued use of TOPTIER after any changes indicates your acceptance of the updated policy. We encourage you to review this page periodically for the latest information on our privacy practices.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">10. Contact Us</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you have questions about this Privacy Policy or our data practices, you can contact us at privacy@toptier.app or through the Support section of the app. Our Data Protection Officer can be reached at dpo@toptier.app for privacy-related inquiries and requests.
        </p>
      </section>
    </div>
  )
}

export function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <Scale className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">Last updated: August 16, 2026</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. Acceptance of Terms</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          By accessing or using the TOPTIER application and services, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any part of these terms, you may not use our services. These terms constitute a legally binding agreement between you and TOPTIER. Your use of the service is also governed by our Privacy Policy, which is incorporated by reference into these terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">2. Description of Service</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER provides an AI-powered trading signal and analysis platform that includes algorithmic trading signal generation based on market data and AI analysis, screenshot analysis for chart pattern recognition, watchlist tracking and price alert notifications, economic calendar and market news aggregation, performance analytics and trading journal, community features for signal sharing and discussion, and educational resources for trading strategies. TOPTIER is an informational and educational tool. It does not execute trades on your behalf, connect to your brokerage account, or provide personalized financial advice. All signals and analyses are for educational and informational purposes only.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">3. Risk Disclaimer</h2>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive leading-relaxed font-medium">
            TRADING INVOLVES SUBSTANTIAL RISK OF LOSS AND IS NOT SUITABLE FOR ALL INVESTORS. PAST PERFORMANCE IS NOT INDICATIVE OF FUTURE RESULTS. THE SIGNALS AND ANALYSES PROVIDED BY TOPTIER ARE FOR EDUCATIONAL AND INFORMATIONAL PURPOSES ONLY AND SHOULD NOT BE CONSTRUED AS FINANCIAL ADVICE. YOU SHOULD NOT TRADE WITH MONEY YOU CANNOT AFFORD TO LOSE. ALWAYS CONSULT A QUALIFIED FINANCIAL ADVISOR BEFORE MAKING INVESTMENT DECISIONS.
          </p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The trading signals, analyses, and other information provided through TOPTIER are based on AI models and algorithmic analysis of market data. These models are not infallible and may produce incorrect or misleading signals. Market conditions can change rapidly, and historical patterns may not predict future movements. You acknowledge that any trading decisions you make are made solely at your own risk, and TOPTIER bears no responsibility for any financial losses you may incur.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">4. User Accounts</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          To use TOPTIER, you must create an account and provide accurate, complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must immediately notify TOPTIER of any unauthorized use of your account. You must be at least 18 years old to create an account. Each person may only maintain one active account. We reserve the right to suspend or terminate accounts that violate these terms or are involved in fraudulent activity.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">5. Subscription and Payments</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER offers free and premium subscription tiers. Premium subscriptions are billed on a recurring basis (monthly or annually) through the applicable app store or payment processor. Subscription fees are non-refundable except as required by law or as described in our refund policy. You may cancel your subscription at any time, and you will continue to have access to premium features until the end of your current billing period. Price changes will be communicated in advance, and your continued use constitutes acceptance of the new pricing.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">6. Intellectual Property</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          All content, features, and functionality of TOPTIER, including but not limited to text, graphics, logos, icons, images, audio clips, software, and their compilation, are the exclusive property of TOPTIER or its licensors and are protected by copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, modify, create derivative works from, publicly display, or exploit any content from TOPTIER without our express written permission. Signals and analyses generated by our AI models are licensed to you for personal, non-commercial use only.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">7. Prohibited Conduct</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You agree not to use TOPTIER to violate any applicable laws or regulations, attempt to gain unauthorized access to our systems or other users&apos; accounts, interfere with or disrupt the integrity or performance of the service, use automated means (bots, scrapers) to access the service, redistribute or resell signals and analyses to third parties, impersonate any person or entity, or misrepresent your affiliation, upload malicious code or content, or use the service for any unlawful, fraudulent, or harmful purpose. Violation of these prohibitions may result in immediate account suspension or termination.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">8. Limitation of Liability</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE, ANY TRADING DECISIONS MADE BASED ON SIGNALS OR ANALYSES PROVIDED, UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR DATA, ANY CONDUCT OR CONTENT OF THIRD PARTIES, OR ANY OTHER MATTER RELATING TO THE SERVICE. THIS LIMITATION APPLIES REGARDLESS OF THE LEGAL THEORY ON WHICH THE CLAIM IS BASED.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">9. Indemnification</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You agree to indemnify and hold harmless TOPTIER and its officers, directors, employees, and agents from any claims, liabilities, damages, losses, and expenses, including reasonable attorney fees, arising out of or in any way connected with your access to or use of the service, your violation of these terms, your violation of any rights of another party, or any trading activities you undertake based on information obtained through TOPTIER. This indemnification obligation will survive termination of these terms and your use of the service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">10. Termination</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may terminate or suspend your account and access to the service immediately, without prior notice, for conduct that we determine, in our sole discretion, violates these terms, is harmful to other users or the service, or for any other reason we deem appropriate. Upon termination, your right to use the service will immediately cease. Provisions of these terms that by their nature should survive termination shall survive, including warranty disclaimers, limitations of liability, and indemnification provisions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">11. Governing Law</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          These terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles. Any disputes arising out of these terms or the service shall be resolved through binding arbitration in accordance with applicable arbitration rules, except that you may seek injunctive relief in any court of competent jurisdiction to prevent irreparable harm.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">12. Contact</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          For questions about these Terms of Service, please contact us at legal@toptier.app or through the Support section of the app. We recommend reviewing these terms periodically as they may be updated from time to time.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">13. Referral Program</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TOPTIER may offer a referral program in which users share a personal referral link. When a new user registers using your link, you earn referral rewards as described in the app (for example, free Premium days). Rewards are credited only after the referred user completes a qualifying action, such as registering with your link or upgrading to a paid subscription. Referral rewards are subject to fraud prevention: self-referrals, duplicate accounts, and referral links distributed through spam, paid advertising, or incentivized traffic may result in forfeiture of rewards and suspension of the referring account. Rewards have no cash value and are non-transferable. TOPTIER may modify or discontinue the referral program at any time.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">14. Copy Trading</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Copy Trading is a community feature that lets users mirror the signals published by other users ("copy traders"). Users who register as copy traders may earn a copy fee on the positive gross profit realized by their followers&apos; copied trades, as configured on their profile. TOPTIER charges a platform fee of 10% on the positive gross profit of copied trades settled through the app. Fees are accrued in the app ledger and paid out through your payout account; they are not deducted by any broker, and no broker affiliation is required to participate. Copy trading mirrors signals based on the performance a copy trader reports; TOPTIER does not guarantee the accuracy of any signal, the performance of any copy trader, or any financial result. Copy traders are not employees, agents, or advisors of TOPTIER. Trading involves substantial risk of loss. By participating, you acknowledge that profits and losses accrue in your own accounts and that fees are owed to TOPTIER as set out in this section.
        </p>
      </section>
    </div>
  )
}
