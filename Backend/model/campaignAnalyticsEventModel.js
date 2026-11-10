import mongoose from 'mongoose';

const campaignAnalyticsEventSchema = new mongoose.Schema({
  campaignType: { type: String, enum: ['ad_campaign', 'community_promotion'], required: true },
  campaign: { type: mongoose.Schema.Types.ObjectId, required: true },
  eventType: { type: String, enum: ['impression', 'click'], required: true },
  visitorId: { type: String, required: true, trim: true, maxlength: 80 },
}, { timestamps: true });

campaignAnalyticsEventSchema.index(
  { campaignType: 1, campaign: 1, eventType: 1, visitorId: 1 },
  { unique: true },
);
campaignAnalyticsEventSchema.index({ campaignType: 1, campaign: 1, eventType: 1 });

export default mongoose.model('CampaignAnalyticsEvent', campaignAnalyticsEventSchema);
