class CabifyLogistics {
  /**
   * @param {import('axios').AxiosInstance} apiClient
   */
  constructor(apiClient) {
    this.client = apiClient;
  }

  /**
   * @param {object} parcelData
   */
  async registerParcel(parcelData) {
    const { data } = await this.client.post("/parcels", parcelData);
    return data;
  }

  /**
   * @param {string} parcelId
   */
  async shipParcel(parcelId) {
    const { data } = await this.client.post(`/parcels/${parcelId}/ship`);
    return data;
  }
}

module.exports = CabifyLogistics;
